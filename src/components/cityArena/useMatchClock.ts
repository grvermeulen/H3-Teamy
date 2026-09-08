"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import * as Sentry from "@sentry/nextjs";
import {
  beginCountdown,
  countdownNumber,
  lobbyMatch,
  secondsLeft,
  stepMatch,
  type MatchPhase,
  type MatchState,
} from "@/lib/cityArena/net/matchPhase";
import { rankScoreboard, type ScoreLine } from "@/lib/cityArena/net/scoreboard";
import type { ArenaGame } from "./useArenaGame";

/**
 * How often the clock reads the simulation.
 *
 * The machine is driven by the tick, not by this interval — polling faster than the eye needs
 * would re-render the overlay for nothing, and polling cannot miss a transition because each poll
 * asks the machine where it should be for the current tick rather than counting elapsed polls.
 */
const POLL_MS = 100;

/** Where a finished potje is posted. */
const MATCHES_URL = "/api/arena/matches";

/** What the host needs in order to post a result. */
export type MatchRecording = {
  roomCode: string | null;
  zone: string;
  isHost: boolean;
};

/** Player id → client id, at one moment. */
type Accounts = ReadonlyMap<number, string>;

/** What the overlay needs to draw the phase it is in. */
export type MatchClock = {
  phase: MatchPhase;
  /** 3, 2 or 1 during the countdown, else `null`. */
  countdown: number | null;
  /** Seconds left in the current phase, or `null` in the lobby. */
  secondsLeft: number | null;
  /** The ranked scorebord, read once the potje ends. */
  scoreboard: ScoreLine[];
  /** Who held which player when the potje ended, so a scorebord row can be named. */
  accounts: Accounts;
  /** Starts the countdown; the host's start button. */
  start: () => void;
  /** Returns the room to its lobby without waiting out the scorebord. */
  backToLobby: () => void;
};

/**
 * Inverts the host's seats: a scorebord row carries the player id the host handed out, and this
 * is what ties it back to the account that earned it.
 */
function accountsFrom(seats: ReadonlyMap<string, number>): Accounts {
  return new Map(
    [...seats].map(([clientId, playerId]) => [playerId, clientId]),
  );
}

/**
 * Posts a finished potje, if this client is the host and there was more than one player.
 *
 * Failures are swallowed after reporting: a scorebord a player is reading must not turn into an
 * error because a write failed, and the server refuses politely when the potje is not ours to
 * post or has already been recorded.
 */
async function postResult(
  lines: ScoreLine[],
  recording: MatchRecording,
  startedAt: Date | null,
  accounts: Accounts,
): Promise<void> {
  if (!recording.isHost || !recording.roomCode || !startedAt) return;
  const results = lines
    .map((line) => ({
      userId: accounts.get(line.playerId),
      kills: line.kills,
      deaths: line.deaths,
      won: line.isWinner,
    }))
    .filter((row): row is { userId: string } & typeof row => !!row.userId);
  // Spec §2 step 4: only a potje that more than one person played is worth recording.
  if (results.length < 2) return;
  try {
    await fetch(MATCHES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomCode: recording.roomCode,
        zone: recording.zone,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        results,
      }),
    });
  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "match-post" },
    });
  }
}

/** The state one reading of the clock writes into. */
type ClockSetters = {
  setCountdown: (count: number | null) => void;
  setLeft: (seconds: number | null) => void;
  setScoreboard: (lines: ScoreLine[]) => void;
  setAccounts: (accounts: Accounts) => void;
  setMatch: (match: MatchState) => void;
};

/** What a reading needs to remember between polls. */
type ClockRefs = {
  match: RefObject<MatchState>;
  recording: RefObject<MatchRecording>;
  startedAt: RefObject<Date | null>;
};

/**
 * One reading of the simulation: moves the clock on when the tick says so.
 *
 * A client follows the host's clock from the snapshot; the host, and a player alone, step their
 * own. Either way the phase comes from the tick, not from counting polls, so a poll can be late
 * without the clock drifting — and two people can never disagree about whether play started.
 */
function pollClock(game: ArenaGame, refs: ClockRefs, set: ClockSetters): void {
  const peek = game.peek();
  if (!peek) return;
  const current = refs.match.current;
  const next = peek.match ?? stepMatch(current, peek.tick);
  set.setCountdown(countdownNumber(next, peek.tick));
  set.setLeft(secondsLeft(next, peek.tick));
  if (next.phase === current.phase && next.since === current.since) return;
  if (next.phase === "playing") refs.startedAt.current = new Date();
  // The scorebord is read at the moment play ends, so a kill landing during the scorebord
  // itself cannot change a result players are already looking at.
  if (next.phase === "scoreboard") {
    const lines = rankScoreboard(peek.tally, peek.players, peek.youId);
    const accounts = accountsFrom(peek.seats);
    set.setScoreboard(lines);
    set.setAccounts(accounts);
    void postResult(
      lines,
      refs.recording.current,
      refs.startedAt.current,
      accounts,
    );
  }
  set.setMatch(next);
  game.setMatch(next);
}

/**
 * Drives the potje's phases from the running simulation.
 *
 * @param game - The running game, polled through its non-subscribing `peek`.
 * @param recording - What the host needs to post the result.
 * @returns The clock, and the two actions that move it.
 */
export function useMatchClock(
  game: ArenaGame,
  recording: MatchRecording,
): MatchClock {
  const [match, setMatch] = useState<MatchState>(lobbyMatch);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [scoreboard, setScoreboard] = useState<ScoreLine[]>([]);
  const [accounts, setAccounts] = useState<Accounts>(new Map());
  const startedAtRef = useRef<Date | null>(null);
  const recordingRef = useRef(recording);
  const matchRef = useRef(match);
  // Mirrored in an effect rather than during render: React 19 forbids writing a ref while
  // rendering, and the interval below only needs the value on its next tick anyway.
  useEffect(() => {
    matchRef.current = match;
    recordingRef.current = recording;
  }, [match, recording]);

  useEffect(() => {
    const refs: ClockRefs = {
      match: matchRef,
      recording: recordingRef,
      startedAt: startedAtRef,
    };
    const set: ClockSetters = {
      setCountdown,
      setLeft,
      setScoreboard,
      setAccounts,
      setMatch,
    };
    const timer = setInterval(() => pollClock(game, refs, set), POLL_MS);
    return () => clearInterval(timer);
  }, [game]);

  const start = useCallback(() => {
    // A fresh potje scores from zero; without this a rematch would inherit the last one's kills.
    game.resetTally();
    const next = beginCountdown(game.peek()?.tick ?? 0);
    setMatch(next);
    game.setMatch(next);
  }, [game]);

  const backToLobby = useCallback(() => {
    const next = lobbyMatch();
    setMatch(next);
    setScoreboard([]);
    setAccounts(new Map());
    game.setMatch(next);
  }, [game]);

  return {
    phase: match.phase,
    countdown,
    secondsLeft: left,
    scoreboard,
    accounts,
    start,
    backToLobby,
  };
}
