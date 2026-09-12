/**
 * The host half of a match (spec §6.6): it owns the simulation, steps it at 30 Hz from everyone's
 * inputs, and publishes a full snapshot at 10 Hz.
 *
 * The loop is driven by {@link HostLoop.advance}, not by a timer of its own. That makes it a pure
 * function of elapsed time and fully testable — `requestAnimationFrame` in the browser and a
 * simulated clock in Vitest exercise exactly the same code.
 */

import * as Sentry from "@sentry/nextjs";
import {
  addArenaPlayer,
  removeArenaPlayer,
  stepArena,
  type ArenaWorld,
} from "../sim/arena";
import {
  EMPTY_INPUT,
  type ArenaInputs,
  type ArenaState,
  type WorldInput,
} from "../sim/types";
import type { MatchState } from "./matchPhase";
import { emptyTally, tallyEvents, type Tally } from "./scoreboard";
import type { RealtimeTransport } from "./transport";
import { decodeInput, type InputFrame } from "./wire";
import { encodeSnapshot } from "./snapshotWire";

/** The simulation runs at 30 Hz (spec §6.6). */
export const HOST_TICK_HZ = 30;
/** Full snapshots go out 10 times a second (spec §6.3). */
export const SNAPSHOT_HZ = 10;
/**
 * The most ticks one `advance` may run. A tab that was backgrounded for a minute must not try to
 * catch up 1 800 ticks in one frame; it drops the backlog instead, losing simulated time, and
 * spec §6.6 covers a host that falls behind by re-electing rather than by catching up.
 */
export const MAX_CATCHUP_TICKS = 5;
/** Consecutive failing ticks after which the host stops publishing so the silence rule re-elects. */
const MAX_CONSECUTIVE_FAILURES = 5;

/** How a host loop is created. */
export type HostLoopOptions = {
  transport: RealtimeTransport;
  roomCode: string;
  world: ArenaWorld;
  /** The state to start from: a fresh match, or the last snapshot after a migration. */
  state: ArenaState;
  /**
   * The tally to continue from: empty for a fresh match, the last snapshot's after a migration,
   * so kills scored under the old host survive it. Defaults to empty.
   */
  tally?: Tally;
  random: () => number;
  /** The host's server time, which clients interpolate against. */
  serverTimeMs: () => number;
  /** The step to run; injectable so a test can drive a failing tick. Defaults to `stepArena`. */
  step?: typeof stepArena;
  /**
   * Called after every tick with the state it produced.
   *
   * Sound and anything else that reads `state.events` must see *every* tick: a catch-up burst runs
   * several per `advance`, and reading only the last would miss the rest.
   */
  onTick?: (state: ArenaState) => void;
};

/** A running host. */
export type HostLoop = {
  /** Runs whole ticks for the elapsed time, publishing snapshots on schedule. */
  advance(elapsedMs: number): void;
  /**
   * The part of a tick the loop has taken in but not yet stepped, 0..1.
   *
   * The renderer draws this far past the last tick, so the world moves at the display's rate
   * rather than in 30 Hz jumps (`render/smoothing.ts`). It is deliberately read-only: the loop
   * still steps whole ticks and nothing about the simulation depends on it.
   */
  stepFraction(): number;
  /**
   * Sets the input for a player this process drives directly — the host's own.
   *
   * The host cannot hear itself over the `:inputs` channel: neither Ably nor the in-memory
   * transport echoes a message back to its publisher.
   */
  setInput(playerId: number, input: WorldInput): void;
  /** The host's tally of kills and deaths, which is the only real one. */
  tally(): Tally;
  /** Who drives which player. */
  seats(): ReadonlyMap<string, number>;
  /** Clears the tally, so a rematch scores from zero. */
  resetTally(): void;
  /** Where the potje is; carried on every snapshot so clients follow the host's clock. */
  match(): MatchState;
  /** Moves the potje on. Only the host's clock calls this (spec §2). */
  setMatch(match: MatchState): void;
  /** Seats a member and returns the player id they were given, or `null` when the match is full. */
  addMember(clientId: string): number | null;
  /**
   * Records that `clientId` drives a player that already exists — the host's own, created with
   * the state before the loop was — rather than spawning a second one for them.
   */
  claim(clientId: string, playerId: number): void;
  /** Removes a member and their player. */
  removeMember(clientId: string): void;
  /** The current authoritative state. */
  state(): ArenaState;
  /** Whether the host is still publishing; false after too many consecutive failures. */
  isPublishing(): boolean;
  /** Stops the loop and releases its subscriptions. */
  stop(): void;
};

/**
 * How long the last frame from a player keeps applying once they go quiet (spec §6.3 has clients
 * heartbeat at 2 Hz, so half a second of silence means the client is gone, not idle).
 *
 * Without this a player whose tab was hidden mid-stride would keep walking in the authoritative
 * world forever, because their last frame stayed in `pending` and was re-applied every tick.
 */
export const INPUT_HOLD_TICKS = HOST_TICK_HZ / 2;

/** The latest input each player sent, its sequence number, and the tick it arrived on. */
type PendingInput = { seq: number; frame: InputFrame; tick: number };

/**
 * Starts hosting a match.
 *
 * @param options - The transport, room, world and the state to host from.
 * @returns The loop, which the caller drives with {@link HostLoop.advance}.
 */
export function createHostLoop(options: HostLoopOptions): HostLoop {
  const step = options.step ?? stepArena;
  const stepSeconds = 1 / HOST_TICK_HZ;
  const ticksPerSnapshot = HOST_TICK_HZ / SNAPSHOT_HZ;
  const room = options.transport.channel(`arena:room:${options.roomCode}`);
  const inputs = options.transport.channel(
    `arena:room:${options.roomCode}:inputs`,
  );

  /** Which player each member drives. A member with no entry is a spectator. */
  const playerByClient = new Map<string, number>();
  /** The newest input per player, kept until the tick that consumes it. */
  const pending = new Map<number, PendingInput>();
  /** The last sequence number applied per player, which clients reconcile against. */
  const lastInputSeqs: Record<number, number> = {};
  /** Inputs from players this process drives itself, applied ahead of anything from the wire. */
  const local = new Map<number, WorldInput>();
  let tally: Tally = options.tally ?? emptyTally();
  // A literal rather than `lobbyMatch()`: matchPhase.ts imports HOST_TICK_HZ from this file, and
  // a value import back would evaluate it before that constant exists.
  let match: MatchState = { phase: "lobby", since: 0 };
  /** Sequence numbers for local inputs, so `lastInputSeqs` stays meaningful for them too. */
  let localSeq = 0;

  let state = options.state;
  /** Elapsed time the loop has been handed, which ticks are derived from rather than subtracted. */
  let elapsedTotalMs = 0;
  /** Ticks the loop has accounted for, including any it dropped when catch-up was capped. */
  let ticksRun = 0;
  let sinceSnapshot = 0;
  let consecutiveFailures = 0;
  let publishing = true;
  let running = true;

  const unsubscribe = inputs.subscribe("input", (message) => {
    const playerId = playerByClient.get(message.clientId);
    if (playerId === undefined) return;
    const frame = message.data as InputFrame;
    const seq = frame[0] ?? 0;
    const current = pending.get(playerId);
    if (current && current.seq >= seq) return;
    pending.set(playerId, { seq, frame, tick: state.tick });
  });

  /**
   * The inputs for this tick: the newest frame per player, `EMPTY_INPUT` for anyone silent —
   * including anyone whose last frame has gone stale.
   */
  function collectInputs(): ArenaInputs {
    const map = new Map<number, ReturnType<typeof decodeInput>["input"]>();
    for (const player of state.players) {
      const own = local.get(player.id);
      if (own) {
        map.set(player.id, own);
        continue;
      }
      const next = pending.get(player.id);
      if (!next || state.tick - next.tick > INPUT_HOLD_TICKS) {
        map.set(player.id, EMPTY_INPUT);
        continue;
      }
      const { seq, input } = decodeInput(next.frame);
      map.set(player.id, input);
      lastInputSeqs[player.id] = seq;
    }
    return map;
  }

  /** Runs one tick, reporting and swallowing a failure so the loop survives it (spec §6.6). */
  function runTick(): void {
    try {
      state = step(
        state,
        collectInputs(),
        stepSeconds,
        options.world,
        options.random,
      );
      tally = tallyEvents(tally, state.events);
      options.onTick?.(state);
      consecutiveFailures = 0;
    } catch (error: unknown) {
      consecutiveFailures += 1;
      Sentry.captureException(error, {
        tags: { area: "arena", kind: "host-tick" },
      });
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) publishing = false;
    }
  }

  /** Publishes the world if a snapshot is due. */
  function maybePublish(): void {
    sinceSnapshot += 1;
    if (sinceSnapshot < ticksPerSnapshot) return;
    sinceSnapshot = 0;
    if (!publishing) return;
    // A host whose snapshots stop reaching the room must show up in Sentry, not vanish: to the
    // other players it just looks like a frozen match.
    void room
      .publish(
        "state",
        encodeSnapshot(state, options.serverTimeMs(), lastInputSeqs, {
          seats: playerByClient,
          tally,
          match,
        }),
      )
      .catch((error: unknown) => {
        Sentry.captureException(error, {
          tags: { area: "arena", kind: "host-snapshot" },
        });
      });
  }

  return {
    stepFraction(): number {
      const exact = (elapsedTotalMs * HOST_TICK_HZ) / 1000;
      return Math.min(1, Math.max(0, exact - ticksRun));
    },
    advance(elapsedMs: number): void {
      if (!running) return;
      elapsedTotalMs += elapsedMs;
      // Derived from the running total rather than by subtracting a step each time: 1000/30 has
      // no exact binary form, so subtracting it compounds and the loop loses roughly one tick per
      // thousand advances — minutes into a match, that is real drift.
      const wanted = Math.floor((elapsedTotalMs * HOST_TICK_HZ) / 1000);
      let ticks = wanted - ticksRun;
      if (ticks <= 0) return;
      if (ticks > MAX_CATCHUP_TICKS) ticks = MAX_CATCHUP_TICKS;
      ticksRun = wanted;
      for (let index = 0; index < ticks; index += 1) {
        runTick();
        maybePublish();
      }
    },
    addMember(clientId: string): number | null {
      // A presence recovery or a repeated join must not seat the same person twice: the first
      // player would be left in the state with nobody driving it, filling one of the eight seats.
      const seated = playerByClient.get(clientId);
      if (seated !== undefined) return seated;
      const joined = addArenaPlayer(
        state,
        options.world,
        state.tick,
        options.random,
      );
      if (!joined.player) return null;
      state = joined.state;
      playerByClient.set(clientId, joined.player.id);
      return joined.player.id;
    },
    claim(clientId: string, playerId: number): void {
      playerByClient.set(clientId, playerId);
    },
    removeMember(clientId: string): void {
      const playerId = playerByClient.get(clientId);
      if (playerId === undefined) return;
      playerByClient.delete(clientId);
      pending.delete(playerId);
      delete lastInputSeqs[playerId];
      state = removeArenaPlayer(state, playerId);
    },
    setInput(playerId: number, input: WorldInput): void {
      local.set(playerId, input);
      localSeq += 1;
      lastInputSeqs[playerId] = localSeq;
    },
    tally(): Tally {
      return tally;
    },
    seats(): ReadonlyMap<string, number> {
      return playerByClient;
    },
    resetTally(): void {
      tally = emptyTally();
    },
    match(): MatchState {
      return match;
    },
    setMatch(next: MatchState): void {
      match = next;
    },
    state(): ArenaState {
      return state;
    },
    isPublishing(): boolean {
      return publishing;
    },
    stop(): void {
      running = false;
      publishing = false;
      unsubscribe();
    },
  };
}
