"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Player id → user id, so a scoreboard row can name the account that earned it. */
  userIdByPlayer: ReadonlyMap<number, string>;
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
  /** Starts the countdown; the host's start button. */
  start: () => void;
  /** Returns the room to its lobby without waiting out the scorebord. */
  backToLobby: () => void;
};

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
): Promise<void> {
  if (!recording.isHost || !recording.roomCode || !startedAt) return;
  const results = lines
    .map((line) => ({
      userId: recording.userIdByPlayer.get(line.playerId),
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

/**
 * Drives the potje's phases from the running simulation.
 *
 * The phase is derived from the simulation tick rather than from wall-clock time, so a browser
 * that throttles a background tab cannot let the match clock drift away from the world the
 * player is actually in.
 *
 * @param game - The running game, polled through its non-subscribing `peek`.
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
    const timer = setInterval(() => {
      const peek = game.peek();
      if (!peek) return;
      const current = matchRef.current;
      const next = stepMatch(current, peek.tick);
      setCountdown(countdownNumber(next, peek.tick));
      setLeft(secondsLeft(next, peek.tick));
      // The scorebord is read at the moment play ends, so a kill landing during the scorebord
      // itself cannot change a result players are already looking at.
      if (next.phase !== current.phase) {
        if (next.phase === "playing") startedAtRef.current = new Date();
        if (next.phase === "scoreboard") {
          const lines = rankScoreboard(peek.tally, peek.players, peek.youId);
          setScoreboard(lines);
          void postResult(lines, recordingRef.current, startedAtRef.current);
        }
        setMatch(next);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [game]);

  const start = useCallback(() => {
    // A fresh potje scores from zero; without this a rematch would inherit the last one's kills.
    game.resetTally();
    const peek = game.peek();
    setMatch(beginCountdown(peek?.tick ?? 0));
  }, [game]);

  const backToLobby = useCallback(() => {
    setMatch(lobbyMatch());
    setScoreboard([]);
  }, []);

  return {
    phase: match.phase,
    countdown,
    secondsLeft: left,
    scoreboard,
    start,
    backToLobby,
  };
}
