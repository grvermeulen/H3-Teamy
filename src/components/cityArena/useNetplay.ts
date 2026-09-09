"use client";

/**
 * Runs the room's loop inside the runtime: the host loop when this client was elected, the
 * client loop otherwise.
 *
 * The runtime keeps stepping alone until the room is ready, so the city is playable in the lobby
 * (spec §2) and a room that never connects still leaves the player something to drive around in.
 */

import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as Sentry from "@sentry/nextjs";
import { createClientLoop } from "@/lib/cityArena/net/clientLoop";
import { createHostLoop, type HostLoop } from "@/lib/cityArena/net/hostLoop";
import type { MatchState } from "@/lib/cityArena/net/matchPhase";
import type { Tally } from "@/lib/cityArena/net/scoreboard";
import { roomChannelName } from "@/lib/cityArena/net/room";
import {
  decodeSnapshot,
  type Snapshot,
} from "@/lib/cityArena/net/snapshotWire";
import type { RealtimeTransport } from "@/lib/cityArena/net/transport";
import type { ArenaWorld } from "@/lib/cityArena/sim/arena";
import { feelTick } from "./arenaFeel";
import type { Runtime } from "./arenaRuntime";

/** The room this game runs in. */
export type ArenaNetplayOptions = {
  /** The live transport; null until the room hook has opened one. */
  transport: () => RealtimeTransport | null;
  /** True once the room is entered and its presence set is known. */
  ready: boolean;
  roomCode: string | null;
  /** This client's id — the user id — or empty before the connection reports it. */
  clientId: string;
  /** Server time minus local time, so both ends keep time by the same clock. */
  clockOffsetMs: number;
  /** Whether this client is the room's elected host right now. */
  isHost: boolean;
  /** Everyone present in the room, by client id, so the host can seat them. */
  memberIds: string[];
};

/** Separator for the member key; client ids are cuids, which never contain it. */
const MEMBER_SEPARATOR = "|";

/** What both loops are built from. */
type LoopSetup = {
  transport: RealtimeTransport;
  roomCode: string;
  clientId: string;
  clockOffsetMs: number;
};

/**
 * What a loop being replaced hands to its successor.
 *
 * React runs the old effect's cleanup before the new effect's setup, so the handover is stashed
 * between the two rather than read from the runtime, which by then is offline again.
 */
type Handover = {
  /** The runtime and room it came from; a handover from another is worthless. */
  runtime: Runtime;
  roomCode: string;
  /** The player this client was driving. */
  playerId: number;
  /** Who was driving what, as far as the old loop knew. */
  seats: ReadonlyMap<string, number>;
  /** Where the potje was, or null when nothing has been heard yet. */
  match: MatchState | null;
  /** Kills and deaths so far, so a migration does not wipe the scorebord. */
  tally: Tally;
};

/** The world the loops step: the session's collision, index and graph, without a viewport. */
function loopWorld(runtime: Runtime): ArenaWorld {
  return {
    collision: runtime.session.collision,
    index: runtime.session.index(),
    graph: runtime.session.graph(),
  };
}

/**
 * Stops whatever loop the runtime was running and goes back to stepping alone — still driving
 * the same player, so a client whose room vanished is not suddenly looking for player 0 in a
 * world that no longer holds one.
 *
 * @returns What the loop knew, so the next one carries on from it rather than from nothing.
 */
function stopNetplay(runtime: Runtime, roomCode: string): Handover {
  const net = runtime.netplay;
  const handover: Handover = {
    runtime,
    roomCode,
    playerId: net.playerId,
    seats: net.kind === "offline" ? new Map() : net.loop.seats(),
    match: net.kind === "offline" ? null : net.loop.match(),
    tally: net.kind === "offline" ? runtime.tally : net.loop.tally(),
  };
  if (net.kind !== "offline") net.loop.stop();
  runtime.netplay = { kind: "offline", playerId: net.playerId };
  return handover;
}

/**
 * Seats everyone present and unseats everyone gone, then shows the runtime the result rather
 * than leaving it a frame behind.
 *
 * `keep` is this client, whose own player must survive a presence set that has not caught up
 * with it yet: unseating yourself leaves a runtime with no player to draw.
 */
function syncSeats(
  runtime: Runtime,
  loop: HostLoop,
  memberIds: string[],
  keep: string,
): void {
  for (const memberId of memberIds)
    if (!loop.seats().has(memberId)) loop.addMember(memberId);
  for (const seated of [...loop.seats().keys()])
    if (seated !== keep && !memberIds.includes(seated))
      loop.removeMember(seated);
  runtime.state = loop.state();
}

/**
 * Starts hosting from whatever this client last knew — its own offline city, or the last snapshot
 * it saw as a client. Every seat the previous loop knew is claimed rather than added again, so a
 * migration keeps everyone's player where it was; whoever has since left is unseated by the
 * seating effect that runs next.
 */
function startHosting(
  runtime: Runtime,
  setup: LoopSetup,
  previous: Handover,
): void {
  const loop = createHostLoop({
    transport: setup.transport,
    roomCode: setup.roomCode,
    world: loopWorld(runtime),
    state: runtime.state,
    random: runtime.random,
    serverTimeMs: () => Date.now() + setup.clockOffsetMs,
    onTick: (state) => feelTick(runtime, state),
    tally: previous.tally,
  });
  for (const [memberId, seat] of previous.seats) loop.claim(memberId, seat);
  loop.claim(setup.clientId, previous.playerId);
  if (previous.match) loop.setMatch(previous.match);
  runtime.state = loop.state();
  runtime.netplay = { kind: "host", loop, playerId: previous.playerId };
}

/** Builds the client loop around the seat the host named, primed with the snapshot that named it. */
function adoptSeat(
  runtime: Runtime,
  setup: LoopSetup,
  seat: number,
  snapshot: Snapshot,
): void {
  const loop = createClientLoop({
    transport: setup.transport,
    roomCode: setup.roomCode,
    world: loopWorld(runtime),
    playerId: seat,
    state: runtime.state,
    random: runtime.random,
    serverTimeMs: () => Date.now() + setup.clockOffsetMs,
    onTick: (state) => feelTick(runtime, state),
  });
  loop.onSnapshot(snapshot);
  // State first, then netplay: myPlayer looks the seat up in whatever state is current.
  runtime.state = loop.view();
  runtime.netplay = { kind: "client", loop, playerId: seat };
}

/**
 * Joins as a client. A client cannot know which player it drives until the host's first snapshot
 * names it in `seats`, so this listens for that snapshot and builds the client loop around the
 * seat it names. Until then the runtime keeps roaming its own city.
 *
 * @returns A function that stops listening, for the effect's cleanup.
 */
function startJoining(runtime: Runtime, setup: LoopSetup): () => void {
  const room = setup.transport.channel(roomChannelName(setup.roomCode));
  return room.subscribe("state", (message) => {
    if (runtime.netplay.kind !== "offline" || runtime.disposed) return;
    try {
      const snapshot = message.data as Snapshot;
      const seat = decodeSnapshot(snapshot).seats.get(setup.clientId);
      if (seat !== undefined) adoptSeat(runtime, setup, seat, snapshot);
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { area: "arena", kind: "client-seat" },
      });
    }
  });
}

/** The stashed handover, if it is for this runtime and room; else what the runtime has now. */
function takeHandover(
  stash: RefObject<Handover | null>,
  runtime: Runtime,
  roomCode: string,
): Handover {
  const stashed = stash.current;
  stash.current = null;
  if (stashed && stashed.runtime === runtime && stashed.roomCode === roomCode)
    return stashed;
  return stopNetplay(runtime, roomCode);
}

/**
 * Runs the right loop for the room once the world has booted, and swaps it when the election
 * changes. Without options — offline free roam, and every test that is not about the room —
 * this does nothing.
 *
 * @param runtimeRef - The runtime the loop steps; null until the world has booted.
 * @param booted - True once the canvas lifecycle reached "playing".
 * @param options - The room, or undefined to run alone.
 */
export function useNetplay(
  runtimeRef: RefObject<Runtime | null>,
  booted: boolean,
  options: ArenaNetplayOptions | undefined,
): void {
  const transport = options?.transport;
  const ready = options?.ready ?? false;
  const roomCode = options?.roomCode ?? null;
  const clientId = options?.clientId ?? "";
  const clockOffsetMs = options?.clockOffsetMs ?? 0;
  const isHost = options?.isHost ?? false;
  const memberKey = options?.memberIds.join(MEMBER_SEPARATOR) ?? "";
  // Derived from the key rather than taken from the options, so a fresh array holding the same
  // members does not re-run the seating effect.
  const memberIds = useMemo(
    () => memberKey.split(MEMBER_SEPARATOR).filter((id) => id.length > 0),
    [memberKey],
  );
  const handoverRef = useRef<Handover | null>(null);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const live = transport?.() ?? null;
    if (!runtime || !live || !booted || !ready || !roomCode || !clientId)
      return undefined;
    const setup: LoopSetup = {
      transport: live,
      roomCode,
      clientId,
      clockOffsetMs,
    };
    const previous = takeHandover(handoverRef, runtime, roomCode);
    const stopListening = isHost
      ? startHosting(runtime, setup, previous)
      : startJoining(runtime, setup);
    return () => {
      stopListening?.();
      handoverRef.current = stopNetplay(runtime, roomCode);
    };
  }, [
    runtimeRef,
    transport,
    booted,
    ready,
    roomCode,
    clientId,
    clockOffsetMs,
    isHost,
  ]);

  // Declared after the loop effect and keyed on everything it is, so a freshly created host loop
  // seats the room in the same commit — and a change of crew alone seats only the difference.
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.netplay.kind !== "host") return;
    syncSeats(runtime, runtime.netplay.loop, memberIds, clientId);
  }, [
    runtimeRef,
    transport,
    booted,
    ready,
    roomCode,
    clientId,
    clockOffsetMs,
    isHost,
    memberIds,
  ]);
}
