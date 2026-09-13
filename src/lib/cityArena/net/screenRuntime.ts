import { createArenaState } from "../sim/arena";
import type { ArenaState } from "../sim/types";
import { createRng, seedFromString } from "../sim/rng";
import type { WorldSession } from "../world/worldSession";
import { findZoneByKey } from "../world/zone";
import { createHostLoop, type HostLoop } from "./hostLoop";
import { createArenaObserver, type ArenaObserver } from "./observerLoop";
import { arenaChannels, type ArenaRoomTicket } from "./roomProtocol";
import { arenaPlayerMembers } from "./roles";
import type { RealtimeTransport } from "./transport";
import { emptyTally, type Tally } from "./scoreboard";
import type { MatchState } from "./matchPhase";
import { smoothFrame } from "../render/smoothing";

/** A display's host/observer loop, with no local player and no input publication. */
export type ArenaScreenRuntime = {
  sync(
    ticket: ArenaRoomTicket,
    transport: RealtimeTransport,
    ready: boolean,
  ): void;
  advance(elapsedMs: number): void;
  state(): ArenaState;
  view(now: number): ArenaState;
  seats(): ReadonlyMap<string, number>;
  accounts(): ReadonlyMap<string, number>;
  tally(): Tally;
  match(): MatchState | null;
  setMatch(match: MatchState): void;
  resetTally(): void;
  hasSnapshot(): boolean;
  isPublishing(): boolean;
  stop(): void;
};

/** Preserves authority state, seat history and score when screens change host epochs. */
export function createArenaScreenRuntime(
  session: Pick<WorldSession, "index" | "graph" | "collision">,
  initial: ArenaRoomTicket,
  serverTime: () => number,
): ArenaScreenRuntime {
  const seed = seedFromString(`screen:${initial.roomId}`);
  const random = createRng(seed);
  let state: ArenaState = {
    ...createArenaState(
      {
        index: session.index(),
        graph: session.graph(),
        zone: findZoneByKey(session.index(), initial.zone) ?? null,
        seed,
      },
      random,
    ),
    players: [],
  };
  let host: HostLoop | null = null;
  let observer: ArenaObserver | null = null;
  let key = "";
  let seats: ReadonlyMap<string, number> = new Map();
  let accounts: ReadonlyMap<string, number> = new Map();
  let tally: Tally = emptyTally();
  let match: MatchState | null = null;
  let received = false;
  let previousState: ArenaState | null = null;
  const stop = (): void => {
    if (host) {
      state = host.state();
      seats = new Map(host.seats());
      accounts = new Map(host.accounts());
      tally = host.tally();
      match = host.match();
    }
    if (observer) {
      state = observer.state();
      const last = observer.snapshot();
      if (last) {
        seats = last.seats;
        accounts = last.accounts;
        tally = last.tally;
        match = last.match;
      }
    }
    host?.stop();
    observer?.stop();
    host = null;
    observer = null;
    previousState = null;
  };
  return {
    sync(ticket, transport, ready) {
      const nextKey =
        ready && ticket.hostClientId
          ? `${ticket.epoch}:${ticket.hostClientId}`
          : "";
      if (key !== nextKey) {
        stop();
        key = nextKey;
        if (nextKey) {
          const channels = arenaChannels(ticket.roomId, ticket.epoch);
          if (ticket.hostClientId === ticket.memberId) {
            host = createHostLoop({
              transport,
              roomCode: ticket.roomCode,
              stateChannel: channels.state,
              inputChannel: channels.inputs,
              state,
              world: {
                index: session.index(),
                graph: session.graph(),
                collision: session.collision,
              },
              random,
              serverTimeMs: serverTime,
              tally,
              accounts,
              onTick: (next) => {
                previousState = state;
                state = next;
              },
            });
            for (const [id, seat] of seats) host.claim(id, seat);
            if (match) host.setMatch(match);
          } else {
            observer = createArenaObserver({
              transport,
              stateChannel: channels.state,
              hostClientId: ticket.hostClientId!,
              zone: ticket.zone,
              initialState: state,
              onSnapshot: () => {
                received = true;
              },
            });
          }
        }
      }
      if (host) {
        const players = arenaPlayerMembers(ticket);
        for (const id of host.seats().keys())
          if (!players.some((player) => player.clientId === id))
            host.removeMember(id);
        for (const player of players) host.addMember(player.clientId);
        state = host.state();
      }
    },
    advance(elapsed) {
      host?.advance(elapsed);
      if (host) state = host.state();
      else if (observer) state = observer.state();
    },
    state: () => host?.state() ?? observer?.state() ?? state,
    view: (now) =>
      observer?.view(now) ??
      (host
        ? {
            ...host.state(),
            ...smoothFrame(previousState, host.state(), host.stepFraction()),
          }
        : state),
    seats: () => host?.seats() ?? observer?.snapshot()?.seats ?? seats,
    accounts: () =>
      host?.accounts() ?? observer?.snapshot()?.accounts ?? accounts,
    tally: () => host?.tally() ?? observer?.snapshot()?.tally ?? tally,
    match: () => (host ? null : (observer?.snapshot()?.match ?? match)),
    setMatch: (next) => host?.setMatch(next),
    resetTally: () => host?.resetTally(),
    hasSnapshot: () => received,
    isPublishing: () => host?.isPublishing() ?? true,
    stop,
  };
}
