/**
 * The client half of a match (spec §6.5): predict your own player, adopt the host for everything
 * else.
 *
 * Prediction is what makes the game feel local over a network — your own moves apply on the frame
 * you make them rather than a round trip later. The price is that the host may disagree, so every
 * snapshot is reconciled: adopt the host's version of you, replay the inputs the host had not seen
 * yet, and blend away whatever error is left. Health, ammo, kills and pickups are never predicted;
 * spec §6.5 makes them host-only, and predicting them produces flicker when the host disagrees.
 */

import * as Sentry from "@sentry/nextjs";
import { stepArena, type ArenaWorld } from "../sim/arena";
import { playerById } from "../sim/players";
import { EMPTY_INPUT, type ArenaState, type WorldInput } from "../sim/types";
import { applySnapshot } from "./snapshotApply";
import type { MatchState } from "./matchPhase";
import { emptyTally, type Tally } from "./scoreboard";
import { decodeSnapshot, type Snapshot } from "./snapshotWire";
import {
  INTERPOLATION_DELAY_MS,
  interpolatePlayers,
  type SnapshotFrame,
} from "./interpolate";
import { encodeInput } from "./wire";
import type { RealtimeTransport } from "./transport";

/** The client predicts at the host's rate, so a replayed tick matches a hosted one exactly. */
export const CLIENT_TICK_HZ = 30;
/** Residual prediction error is blended out over this long. */
export const RECONCILE_BLEND_MS = 100;
/** Above this the error is too large to hide; snap instead. */
export const SNAP_DISTANCE_M = 3;
/** Snapshots kept for interpolation; two is the minimum, a few gives slack when one is late. */
const FRAME_BUFFER = 6;
/** The most inputs kept for replay: two seconds, far longer than any sane round trip. */
const MAX_BUFFERED_INPUTS = CLIENT_TICK_HZ * 2;

/** How a client loop is created. */
export type ClientLoopOptions = {
  transport: RealtimeTransport;
  roomCode: string;
  world: ArenaWorld;
  /** Which player in the state this client drives. */
  playerId: number;
  /** The world to predict from until the first snapshot lands. */
  state: ArenaState;
  random: () => number;
  /** This client's estimate of host time. */
  serverTimeMs: () => number;
  /**
   * Only snapshots published by this client are applied; anyone else publishing on the channel is
   * ignored, so a member cannot fork the match by playing host (spec §6.6). Omitted, every
   * snapshot is trusted — the bots, and the loop's own tests.
   */
  hostClientId?: string;
  /** The step to run; injectable for tests. Defaults to `stepArena`. */
  step?: typeof stepArena;
  /** Called after every predicted tick, so sound can react to what this client just did. */
  onTick?: (state: ArenaState) => void;
};

/** A running client. */
export type ClientLoop = {
  /** Predicts forward for the elapsed time, publishing this client's input as it goes. */
  advance(elapsedMs: number): void;
  /**
   * The part of a tick predicted time has reached but not yet stepped, 0..1.
   *
   * The renderer draws this far past the last predicted tick so the local player and their car
   * move at the display's rate instead of in 30 Hz jumps (`render/smoothing.ts`). Remote players
   * are already smooth — {@link view} interpolates them against server time — and blending two of
   * those poses leaves them smooth.
   */
  stepFraction(): number;
  /** Sets the input this client is holding; it applies from the next predicted tick. */
  setInput(input: WorldInput): void;
  /** Folds in a snapshot from the host and replays anything it had not seen. */
  onSnapshot(snapshot: Snapshot): void;
  /** The predicted world, unblended — what the simulation believes. */
  state(): ArenaState;
  /** The world to draw: predicted for you, interpolated and blended for everyone else. */
  view(): ArenaState;
  /** Who drives which player, as the host last said; empty before the first snapshot. */
  seats(): ReadonlyMap<string, number>;
  /** The host's tally as of the last snapshot — the only real one; predicted kills are not. */
  tally(): Tally;
  /** Where the host says the potje is; `null` before the first snapshot. */
  match(): MatchState | null;
  /** Stops the loop and releases its subscriptions. */
  stop(): void;
};

/** One input kept for replay. */
type BufferedInput = { seq: number; input: WorldInput };

/** How far the drawn position still lags the predicted one, and how long is left to close it. */
type Reconciliation = { x: number; y: number; leftMs: number };

/**
 * Starts playing as a client.
 *
 * @param options - The transport, room, world and which player this client drives.
 * @returns The loop, which the caller drives with {@link ClientLoop.advance}.
 */
export function createClientLoop(options: ClientLoopOptions): ClientLoop {
  const step = options.step ?? stepArena;
  const stepSeconds = 1 / CLIENT_TICK_HZ;
  const inputs = options.transport.channel(
    `arena:room:${options.roomCode}:inputs`,
  );
  const room = options.transport.channel(`arena:room:${options.roomCode}`);

  const buffered: BufferedInput[] = [];
  const frames: SnapshotFrame[] = [];

  let predicted = options.state;
  let held: WorldInput = EMPTY_INPUT;
  let seq = 0;
  let elapsedTotalMs = 0;
  let ticksRun = 0;
  let offset: Reconciliation = { x: 0, y: 0, leftMs: 0 };
  let running = true;
  let seats: ReadonlyMap<string, number> = new Map();
  let tally: Tally = emptyTally();
  let match: MatchState | null = null;

  const unsubscribe = room.subscribe("state", (message) => {
    if (!running) return;
    if (
      options.hostClientId !== undefined &&
      message.clientId !== options.hostClientId
    )
      return;
    try {
      onSnapshot(message.data as Snapshot);
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { area: "arena", kind: "client-snapshot" },
      });
    }
  });

  /** Runs one predicted tick from the input this client is holding. */
  function predictTick(): void {
    seq += 1;
    buffered.push({ seq, input: held });
    if (buffered.length > MAX_BUFFERED_INPUTS) buffered.shift();
    // This runs every predicted tick, so a transport that keeps refusing would otherwise be an
    // unhandled rejection thirty times a second and nothing in Sentry.
    void inputs
      .publish("input", encodeInput(seq, held))
      .catch((error: unknown) => {
        Sentry.captureException(error, {
          tags: { area: "arena", kind: "client-input" },
        });
      });
    predicted = step(
      predicted,
      new Map([[options.playerId, held]]),
      stepSeconds,
      options.world,
      options.random,
    );
    options.onTick?.(predicted);
  }

  /** Re-applies every buffered input the host had not yet seen. */
  function replayFrom(state: ArenaState, acknowledged: number): ArenaState {
    let replayed = state;
    for (const entry of buffered) {
      if (entry.seq <= acknowledged) continue;
      replayed = step(
        replayed,
        new Map([[options.playerId, entry.input]]),
        stepSeconds,
        options.world,
        options.random,
      );
    }
    return replayed;
  }

  /** Folds in a snapshot, replays unacknowledged inputs and records the error left over. */
  function onSnapshot(snapshot: Snapshot): void {
    const view = decodeSnapshot(snapshot);
    seats = view.seats;
    tally = view.tally;
    match = view.match;
    frames.push({ serverTimeMs: view.serverTimeMs, players: view.players });
    while (frames.length > FRAME_BUFFER) frames.shift();

    const before = playerById(predicted, options.playerId);
    const acknowledged = view.lastInputSeqs[options.playerId] ?? 0;
    const replayed = replayFrom(applySnapshot(predicted, view), acknowledged);
    const after = playerById(replayed, options.playerId);
    predicted = replayed;
    while (buffered.length > 0 && (buffered[0]?.seq ?? 0) <= acknowledged)
      buffered.shift();

    if (!before || !after) {
      offset = { x: 0, y: 0, leftMs: 0 };
      return;
    }
    const errorX = before.x - after.x;
    const errorY = before.y - after.y;
    // A small disagreement is hidden by walking it off over 100 ms; a large one means the client
    // was wrong about something structural, and pretending otherwise just slides the player.
    offset =
      Math.hypot(errorX, errorY) > SNAP_DISTANCE_M
        ? { x: 0, y: 0, leftMs: 0 }
        : { x: errorX, y: errorY, leftMs: RECONCILE_BLEND_MS };
  }

  /** Decays the reconciliation offset towards zero. */
  function decayOffset(elapsedMs: number): void {
    if (offset.leftMs <= 0) return;
    const left = Math.max(0, offset.leftMs - elapsedMs);
    const scale = left / RECONCILE_BLEND_MS;
    offset = { x: offset.x * scale, y: offset.y * scale, leftMs: left };
  }

  return {
    stepFraction(): number {
      const exact = (elapsedTotalMs * CLIENT_TICK_HZ) / 1000;
      return Math.min(1, Math.max(0, exact - ticksRun));
    },
    advance(elapsedMs: number): void {
      if (!running) return;
      elapsedTotalMs += elapsedMs;
      decayOffset(elapsedMs);
      const wanted = Math.floor((elapsedTotalMs * CLIENT_TICK_HZ) / 1000);
      const ticks = wanted - ticksRun;
      if (ticks <= 0) return;
      ticksRun = wanted;
      for (let index = 0; index < ticks; index += 1) predictTick();
    },
    setInput(input: WorldInput): void {
      held = input;
    },
    seats(): ReadonlyMap<string, number> {
      return seats;
    },
    tally(): Tally {
      return tally;
    },
    match(): MatchState | null {
      return match;
    },
    onSnapshot,
    state(): ArenaState {
      return predicted;
    },
    view(): ArenaState {
      const poses = interpolatePlayers(
        frames,
        options.serverTimeMs() - INTERPOLATION_DELAY_MS,
      );
      return {
        ...predicted,
        players: predicted.players.map((player) => {
          if (player.id === options.playerId)
            return {
              ...player,
              x: player.x + offset.x,
              y: player.y + offset.y,
            };
          const pose = poses.get(player.id);
          return pose ? { ...player, ...pose } : player;
        }),
      };
    },
    stop(): void {
      running = false;
      unsubscribe();
    },
  };
}
