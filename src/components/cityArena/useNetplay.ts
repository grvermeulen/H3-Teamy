"use client";

/**
 * Runs the room's loop inside the runtime: the host loop when this client was elected, the
 * client loop otherwise — and notices when the host has gone (spec §6.6).
 *
 * The runtime keeps stepping alone until the room is ready, so the city is playable in the lobby
 * (spec §2) and a room that never connects still leaves the player something to drive around in.
 */

import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as Sentry from "@sentry/nextjs";
import { createClientLoop } from "@/lib/cityArena/net/clientLoop";
import { createHostWatch, type HostWatch } from "@/lib/cityArena/net/election";
import { createHostLoop, type HostLoop } from "@/lib/cityArena/net/hostLoop";
import type { MatchState } from "@/lib/cityArena/net/matchPhase";
import { roomChannelName } from "@/lib/cityArena/net/room";
import type { Tally } from "@/lib/cityArena/net/scoreboard";
import {
  decodeSnapshot,
  type Snapshot,
} from "@/lib/cityArena/net/snapshotWire";
import type { RealtimeTransport } from "@/lib/cityArena/net/transport";
import {
  isSnapshot,
  recordInvalidWireMessage,
} from "@/lib/cityArena/net/wireValidation";
import type { ArenaWorld } from "@/lib/cityArena/sim/arena";
import { feelTick } from "./arenaFeel";
import type { Runtime } from "./arenaRuntime";
import { cutTo, myPlayer } from "./arenaRuntime";

/** The room this game runs in. */
export type ArenaNetplayOptions = {
  /** The live transport; null until the room hook has opened one. */
  transport: () => RealtimeTransport | null;
  /** True once the room is entered and its presence set is known. */
  ready: boolean;
  /** True while this client's own connection is up; a quiet host means nothing otherwise. */
  connected: boolean;
  roomCode: string | null;
  /** Physical channels issued for the current server host epoch. */
  stateChannel?: string;
  inputChannel?: string;
  /** Server-issued membership ID, or empty before the connection reports it. */
  clientId: string;
  /** Server time minus local time, so both ends keep time by the same clock. */
  clockOffsetMs: number;
  /** The elected host, or null while nobody is. Only its snapshots are trusted. */
  hostClientId: string | null;
  /** Whether this client is the room's elected host right now. */
  isHost: boolean;
  /** Everyone present in the room, by client id, so the host can seat them. */
  memberIds: string[];
  /**
   * Called with the host to re-elect without: the one in `hostClientId` after it has been quiet
   * for the silence window, or this client itself when, hosting, it hears another member publish
   * the world — the room already moved on while this tab was throttled (spec §6.6).
   */
  onHostLost: (clientId: string) => void;
};

/** Separator for the member key; client ids are cuids, which never contain it. */
const MEMBER_SEPARATOR = "|";

/** How often the silence watch is fed; coarse is fine against a three-second window. */
export const WATCH_POLL_MS = 500;

/** What both loops are built from. */
type LoopSetup = {
  transport: RealtimeTransport;
  roomCode: string;
  stateChannel?: string;
  inputChannel?: string;
  clientId: string;
  hostClientId: string;
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
  accounts: ReadonlyMap<string, number>;
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
    accounts: net.kind === "offline" ? new Map() : net.loop.accounts(),
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
  for (const seated of [...loop.seats().keys()])
    if (seated !== keep && !memberIds.includes(seated))
      loop.removeMember(seated);
  for (const memberId of memberIds)
    if (!loop.seats().has(memberId)) loop.addMember(memberId);
  runtime.state = loop.state();
}

/**
 * Starts hosting from whatever this client last knew — its own offline city, or the last snapshot
 * it saw as a client. Every seat the previous loop knew is claimed rather than added again, so a
 * migration keeps everyone's player where it was; whoever has since left is unseated by the
 * seating effect that runs next.
 *
 * @returns A function that stops listening for a rival, for the effect's cleanup.
 */
function startHosting(
  runtime: Runtime,
  setup: LoopSetup,
  previous: Handover,
  onUsurped: () => void,
): () => void {
  const loop = createHostLoop({
    transport: setup.transport,
    roomCode: setup.roomCode,
    stateChannel: setup.stateChannel,
    inputChannel: setup.inputChannel,
    world: loopWorld(runtime),
    state: runtime.state,
    random: runtime.random,
    serverTimeMs: () => Date.now() + setup.clockOffsetMs,
    onTick: (state) => feelTick(runtime, state),
    tally: previous.tally,
    accounts: previous.accounts,
  });
  for (const [memberId, seat] of previous.seats) loop.claim(memberId, seat);
  loop.claim(setup.clientId, previous.playerId);
  if (previous.match) loop.setMatch(previous.match);
  runtime.state = loop.state();
  runtime.netplay = { kind: "host", loop, playerId: previous.playerId };
  const room = setup.transport.channel(
    setup.stateChannel ?? roomChannelName(setup.roomCode),
  );
  return room.subscribe("state", (message) => {
    // Another member publishing the world means the room re-elected while this tab was quiet.
    // Stepping down is what stops the match forking into two.
    if (message.clientId !== setup.clientId && isSnapshot(message.data))
      onUsurped();
  });
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
    stateChannel: setup.stateChannel,
    inputChannel: setup.inputChannel,
    world: loopWorld(runtime),
    playerId: seat,
    state: runtime.state,
    random: runtime.random,
    serverTimeMs: () => Date.now() + setup.clockOffsetMs,
    hostClientId: setup.hostClientId,
    onTick: (state) => feelTick(runtime, state),
  });
  loop.onSnapshot(snapshot);
  // State first, then netplay: myPlayer looks the seat up in whatever state is current.
  runtime.state = loop.view();
  runtime.netplay = { kind: "client", loop, playerId: seat };
  // The seat is wherever the host put us, usually far from where we were roaming: cut, do not fly.
  const me = myPlayer(runtime);
  cutTo(runtime, [me.x, me.y]);
}

/**
 * Joins as a client. A client cannot know which player it drives until the host's first snapshot
 * names it in `seats`, so this listens for that snapshot and builds the client loop around the
 * seat it names. Until then the runtime keeps roaming its own city. Every snapshot from the host,
 * seated or not, also feeds the silence watch.
 *
 * @returns A function that stops listening, for the effect's cleanup.
 */
function startJoining(
  runtime: Runtime,
  setup: LoopSetup,
  watch: () => HostWatch,
): () => void {
  const room = setup.transport.channel(
    setup.stateChannel ?? roomChannelName(setup.roomCode),
  );
  return room.subscribe("state", (message) => {
    if (message.clientId !== setup.hostClientId) return;
    if (!isSnapshot(message.data)) {
      recordInvalidWireMessage("snapshot");
      return;
    }
    watch().sawSnapshot();
    if (
      runtime.netplay.kind !== "offline" ||
      runtime.disposed ||
      message.data.r !== undefined
    )
      return;
    try {
      const snapshot = message.data;
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

/** The scalar pieces of the options, so the effects below can list plain dependencies. */
type NetplayInputs = {
  transport: (() => RealtimeTransport | null) | undefined;
  ready: boolean;
  connected: boolean;
  roomCode: string | null;
  stateChannel?: string;
  inputChannel?: string;
  clientId: string;
  clockOffsetMs: number;
  hostClientId: string | null;
  isHost: boolean;
  memberKey: string;
  onHostLost: ((clientId: string) => void) | undefined;
};

/** Reads the options into plain values; absent options read as a room that is not there. */
function inputsFrom(options: ArenaNetplayOptions | undefined): NetplayInputs {
  return {
    transport: options?.transport,
    ready: options?.ready ?? false,
    connected: options?.connected ?? false,
    roomCode: options?.roomCode ?? null,
    stateChannel: options?.stateChannel,
    inputChannel: options?.inputChannel,
    clientId: options?.clientId ?? "",
    clockOffsetMs: options?.clockOffsetMs ?? 0,
    hostClientId: options?.hostClientId ?? null,
    isHost: options?.isHost ?? false,
    memberKey: options?.memberIds.join(MEMBER_SEPARATOR) ?? "",
    onHostLost: options?.onHostLost,
  };
}

/**
 * Calls for a re-election once the host has been quiet for the silence window (spec §6.6).
 *
 * The watch is replaced whenever the host changes or this client's own connection comes back:
 * quiet time under the previous host, or while nothing could arrive anyway, says nothing about
 * the host that is publishing now.
 */
function useSilenceWatch(
  watchRef: RefObject<HostWatch>,
  active: boolean,
  hostClientId: string | null,
  onHostLost: ((clientId: string) => void) | undefined,
): void {
  useEffect(() => {
    if (!active || !hostClientId || !onHostLost) return undefined;
    watchRef.current = createHostWatch();
    const timer = setInterval(() => {
      const watch = watchRef.current;
      watch.elapsed(WATCH_POLL_MS);
      if (!watch.isSilent()) return;
      clearInterval(timer);
      onHostLost(hostClientId);
    }, WATCH_POLL_MS);
    return () => clearInterval(timer);
  }, [watchRef, active, hostClientId, onHostLost]);
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
  const {
    transport,
    ready,
    connected,
    roomCode,
    stateChannel,
    inputChannel,
    clientId,
    clockOffsetMs,
    hostClientId,
    isHost,
    memberKey,
    onHostLost,
  } = inputsFrom(options);
  // Derived from the key rather than taken from the options, so a fresh array holding the same
  // members does not re-run the seating effect.
  const memberIds = useMemo(
    () => memberKey.split(MEMBER_SEPARATOR).filter((id) => id.length > 0),
    [memberKey],
  );
  const handoverRef = useRef<Handover | null>(null);
  const watchRef = useRef<HostWatch>(createHostWatch());

  useEffect(() => {
    const runtime = runtimeRef.current;
    const live = transport?.() ?? null;
    if (!runtime || !live || !booted || !ready || !roomCode || !clientId)
      return undefined;
    if (!hostClientId) return undefined;
    const setup: LoopSetup = {
      transport: live,
      roomCode,
      stateChannel,
      inputChannel,
      clientId,
      hostClientId,
      clockOffsetMs,
    };
    const previous = takeHandover(handoverRef, runtime, roomCode);
    const stopListening = isHost
      ? startHosting(runtime, setup, previous, () => onHostLost?.(clientId))
      : startJoining(runtime, setup, () => watchRef.current);
    return () => {
      stopListening();
      handoverRef.current = stopNetplay(runtime, roomCode);
    };
  }, [
    runtimeRef,
    transport,
    booted,
    ready,
    roomCode,
    stateChannel,
    inputChannel,
    clientId,
    clockOffsetMs,
    hostClientId,
    isHost,
    onHostLost,
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
    stateChannel,
    inputChannel,
    clientId,
    clockOffsetMs,
    hostClientId,
    isHost,
    onHostLost,
    memberIds,
  ]);

  useSilenceWatch(
    watchRef,
    booted && ready && connected && !isHost,
    hostClientId,
    onHostLost,
  );

  useEffect(() => {
    if (!isHost || !ready || !connected || !onHostLost) return undefined;
    const timer = setInterval(() => {
      const net = runtimeRef.current?.netplay;
      if (net?.kind !== "host" || net.loop.isPublishing()) return;
      clearInterval(timer);
      onHostLost(clientId);
    }, WATCH_POLL_MS);
    return () => clearInterval(timer);
  }, [runtimeRef, isHost, ready, connected, onHostLost, clientId]);
}
