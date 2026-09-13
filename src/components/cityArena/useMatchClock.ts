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
import { ArenaRequestError } from "@/lib/cityArena/net/roomClient";
import {
  ROOM_RULES,
  type ArenaRoomTicket,
} from "@/lib/cityArena/net/roomProtocol";

/**
 * How often the clock reads the simulation.
 *
 * Multiplayer uses server-issued wall-clock deadlines; offline play uses simulation ticks.
 */
const POLL_MS = 100;

/** Where a finished potje is posted. */
const MATCHES_URL = "/api/arena/matches";

/** What the host needs in order to post a result. */
export type MatchRecording = {
  roomCode: string | null;
  zone: string;
  isHost: boolean;
  ticket?: ArenaRoomTicket | null;
  clockOffsetMs?: number;
  startRound?: () => Promise<ArenaRoomTicket>;
};

/** Player id → client id, at one moment. */
type Accounts = ReadonlyMap<number, string>;
type PendingResult = {
  lines: ScoreLine[];
  accounts: Accounts;
  ticket: ArenaRoomTicket;
};

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
  start: () => Promise<void>;
  /** Returns the room to its lobby without waiting out the scorebord. */
  backToLobby: () => void;
  saving: boolean;
  error: string | null;
  retryResult: () => void;
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
 * Posts a server-issued round as its current host; the caller retains failed results for retry.
 */
async function postResult(
  lines: ScoreLine[],
  recording: MatchRecording,
  accounts: Accounts,
): Promise<void> {
  const ticket = recording.ticket;
  if (!recording.isHost || !ticket?.round) return;
  const results = lines
    .map((line) => ({
      memberId: accounts.get(line.playerId),
      kills: line.kills,
      deaths: line.deaths,
      won: line.isWinner,
    }))
    .filter((row): row is { memberId: string } & typeof row => !!row.memberId);
  const response = await fetch(MATCHES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roundId: ticket.round.id,
      memberId: ticket.memberId,
      epoch: ticket.epoch,
      results,
    }),
  });
  if (!response.ok) {
    const body: unknown = await response.json();
    const message = (body as { error?: unknown }).error;
    throw new ArenaRequestError(
      typeof message === "string"
        ? message
        : "De uitslag kon niet worden opgeslagen",
      response.status,
    );
  }
}

/** The state one reading of the clock writes into. */
type ClockSetters = {
  setCountdown: (count: number | null) => void;
  setLeft: (seconds: number | null) => void;
  setScoreboard: (lines: ScoreLine[]) => void;
  setAccounts: (accounts: Accounts) => void;
  setMatch: (match: MatchState) => void;
  submit: (lines: ScoreLine[], accounts: Accounts) => void;
  resume: () => void;
};

/** What a reading needs to remember between polls. */
type ClockRefs = {
  match: RefObject<MatchState>;
  recording: RefObject<MatchRecording>;
  dismissedRound: RefObject<string | null>;
  pending: RefObject<PendingResult | null>;
};

/**
 * Derives multiplayer phases from server deadlines, retaining the scoreboard until results are saved.
 */
function pollClock(game: ArenaGame, refs: ClockRefs, set: ClockSetters): void {
  const peek = game.peek();
  if (!peek) return;
  const current = refs.match.current;
  const recording = refs.recording.current;
  const round = recording.ticket?.round;
  let next = peek.match ?? stepMatch(current, peek.tick);
  if (round) {
    const now = Date.now() + (recording.clockOffsetMs ?? 0);
    const phase =
      refs.dismissedRound.current === round.id
        ? "lobby"
        : now < round.startedAt
          ? "countdown"
          : now < round.finishesAt
            ? "playing"
            : now < round.finishesAt + 10_000 ||
                !round.completedAt ||
                refs.pending.current
              ? "scoreboard"
              : "lobby";
    next = {
      phase,
      since: phase === current.phase ? current.since : peek.tick,
    };
    set.setCountdown(
      phase === "countdown"
        ? Math.min(
            ROOM_RULES.countdownMs / 1000,
            Math.max(1, Math.ceil((round.startedAt - now) / 1000)),
          )
        : null,
    );
    set.setLeft(
      phase === "playing"
        ? Math.max(0, Math.ceil((round.finishesAt - now) / 1000))
        : phase === "scoreboard"
          ? Math.max(0, Math.ceil((round.finishesAt + 10_000 - now) / 1000))
          : null,
    );
  } else {
    set.setCountdown(countdownNumber(next, peek.tick));
    set.setLeft(secondsLeft(next, peek.tick));
  }
  if (next.phase === current.phase && next.since === current.since) {
    if (next.phase === "scoreboard") set.resume();
    return;
  }
  // The scorebord is read at the moment play ends, so a kill landing during the scorebord
  // itself cannot change a result players are already looking at.
  if (next.phase === "scoreboard") {
    const lines = rankScoreboard(peek.tally, peek.players, peek.youId);
    const accounts = accountsFrom(peek.seats);
    set.setScoreboard(lines);
    set.setAccounts(accounts);
    set.submit(lines, accounts);
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<PendingResult | null>(null);
  const attemptedRef = useRef<string | null>(null);
  const dismissedRoundRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const startingRef = useRef(false);
  const startedTicketRef = useRef<ArenaRoomTicket | null>(null);
  const recordingRef = useRef(recording);
  const matchRef = useRef(match);
  // Mirrored in an effect rather than during render: React 19 forbids writing a ref while
  // rendering, and the interval below only needs the value on its next tick anyway.
  useEffect(() => {
    matchRef.current = match;
    recordingRef.current = {
      ...recording,
      ticket: recording.ticket?.round
        ? recording.ticket
        : (startedTicketRef.current ?? recording.ticket),
    };
  }, [match, recording]);

  const submit = useCallback(
    (lines: ScoreLine[], postedAccounts: Accounts): void => {
      const current = recordingRef.current;
      const ticket = current.ticket;
      if (!ticket?.round || savingRef.current) return;
      if (ticket.round.completedAt) {
        pendingRef.current = null;
        setError(null);
        return;
      }
      pendingRef.current ??= { lines, accounts: postedAccounts, ticket };
      const pending = pendingRef.current;
      if (
        ticket.round.id !== pending.ticket.round?.id ||
        ticket.roomId !== pending.ticket.roomId
      )
        return;
      const attempt = `${ticket.round.id}:${ticket.epoch}`;
      if (!current.isHost || attemptedRef.current === attempt) return;
      // Allow for sub-second clock offset uncertainty before asking the server to complete.
      if (
        Date.now() + (current.clockOffsetMs ?? 0) <
        ticket.round.finishesAt + 500
      )
        return;
      attemptedRef.current = attempt;
      savingRef.current = true;
      setSaving(true);
      setError(null);
      void postResult(
        pending.lines,
        { ...current, ticket: { ...ticket, round: pending.ticket.round } },
        pending.accounts,
      )
        .then(() => {
          pendingRef.current = null;
        })
        .catch((caught: unknown) => {
          if (!(caught instanceof ArenaRequestError && caught.status < 500))
            Sentry.captureException(caught, {
              tags: { area: "arena", kind: "match-post" },
            });
          setError(
            caught instanceof Error
              ? caught.message
              : "De uitslag kon niet worden opgeslagen",
          );
        })
        .finally(() => {
          savingRef.current = false;
          setSaving(false);
        });
    },
    [],
  );
  const retryResult = useCallback((): void => {
    const pending = pendingRef.current;
    if (pending) {
      attemptedRef.current = null;
      submit(pending.lines, pending.accounts);
    }
  }, [submit]);
  const resumeResult = useCallback((): void => {
    const pending = pendingRef.current;
    if (pending) submit(pending.lines, pending.accounts);
  }, [submit]);

  useEffect(() => {
    const refs: ClockRefs = {
      match: matchRef,
      recording: recordingRef,
      dismissedRound: dismissedRoundRef,
      pending: pendingRef,
    };
    const set: ClockSetters = {
      setCountdown,
      setLeft,
      setScoreboard,
      setAccounts,
      setMatch,
      submit,
      resume: resumeResult,
    };
    const timer = setInterval(() => {
      if (!document.hidden) pollClock(game, refs, set);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [game, submit, resumeResult]);

  const start = useCallback(async () => {
    if (startingRef.current || savingRef.current || pendingRef.current) return;
    startingRef.current = true;
    try {
      if (recordingRef.current.startRound) {
        const ticket = await recordingRef.current.startRound();
        startedTicketRef.current = ticket;
        recordingRef.current = { ...recordingRef.current, ticket };
      }
    } catch (caught: unknown) {
      if (!(caught instanceof ArenaRequestError && caught.status < 500))
        Sentry.captureException(caught, {
          tags: { area: "arena", kind: "match-start" },
        });
      setError(
        caught instanceof Error ? caught.message : "Het potje kon niet starten",
      );
      startingRef.current = false;
      return;
    }
    setError(null);
    dismissedRoundRef.current = null;
    // A fresh potje scores from zero; without this a rematch would inherit the last one's kills.
    game.resetTally();
    const next = beginCountdown(game.peek()?.tick ?? 0);
    setMatch(next);
    game.setMatch(next);
    startingRef.current = false;
  }, [game]);

  const backToLobby = useCallback(() => {
    if (savingRef.current || pendingRef.current) return;
    dismissedRoundRef.current = recordingRef.current.ticket?.round?.id ?? null;
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
    saving,
    error,
    retryResult,
  };
}
