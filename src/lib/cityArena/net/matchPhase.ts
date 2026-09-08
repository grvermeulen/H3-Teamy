/**
 * The shape of a potje: lobby → aftellen → wedstrijd → scorebord → lobby (spec §2).
 *
 * A pure state machine over ticks. It reads no clock and owns no timer, so the host drives it from
 * the simulation tick it already has and a test drives it by counting — which means the countdown
 * a player sees and the countdown a test asserts are the same arithmetic.
 *
 * Only the host advances it. Clients are told the phase in the snapshot and never decide it for
 * themselves, so two people can never disagree about whether the match has started.
 */

import { HOST_TICK_HZ } from "./hostLoop";

/** Seconds of countdown before a match begins (spec §2). */
export const COUNTDOWN_SECONDS = 3;
/** Seconds one match lasts (spec §2). */
export const MATCH_SECONDS = 180;
/** Seconds the scoreboard is shown before the room returns to its lobby (spec §2). */
export const SCOREBOARD_SECONDS = 10;

/** Countdown length in ticks. */
export const COUNTDOWN_TICKS = COUNTDOWN_SECONDS * HOST_TICK_HZ;
/** Match length in ticks. */
export const MATCH_TICKS = MATCH_SECONDS * HOST_TICK_HZ;
/** Scoreboard length in ticks. */
export const SCOREBOARD_TICKS = SCOREBOARD_SECONDS * HOST_TICK_HZ;

/** Where a room is in the potje. */
export type MatchPhase = "lobby" | "countdown" | "playing" | "scoreboard";

/** How long each phase runs; the lobby waits for the host instead of a clock. */
const PHASE_TICKS: Record<MatchPhase, number | null> = {
  lobby: null,
  countdown: COUNTDOWN_TICKS,
  playing: MATCH_TICKS,
  scoreboard: SCOREBOARD_TICKS,
};

/** What comes after a phase runs out. */
const NEXT_PHASE: Record<MatchPhase, MatchPhase> = {
  lobby: "countdown",
  countdown: "playing",
  playing: "scoreboard",
  scoreboard: "lobby",
};

/** The phase, and the tick it began on. */
export type MatchState = {
  phase: MatchPhase;
  /** The tick this phase started; every remaining-time answer is derived from it. */
  since: number;
};

/** A room that is waiting for its host. */
export function lobbyMatch(): MatchState {
  return { phase: "lobby", since: 0 };
}

/**
 * Starts the countdown, which is the only transition a person triggers.
 *
 * @param tick - The tick the host pressed start.
 * @returns The state at the top of the countdown.
 */
export function beginCountdown(tick: number): MatchState {
  return { phase: "countdown", since: tick };
}

/**
 * Ticks the machine, moving on when the current phase has run its length.
 *
 * A phase that overruns by more than its own length — a host that stalled, or a tab that came
 * back from the background — advances once rather than looping through several phases, so a
 * freeze cannot skip a whole potje.
 *
 * @param state - The current phase.
 * @param tick - The simulation tick now.
 * @returns The phase after this tick.
 */
export function stepMatch(state: MatchState, tick: number): MatchState {
  const length = PHASE_TICKS[state.phase];
  if (length === null) return state;
  if (tick - state.since < length) return state;
  return { phase: NEXT_PHASE[state.phase], since: tick };
}

/**
 * Ticks left in the current phase.
 *
 * @param state - The current phase.
 * @param tick - The simulation tick now.
 * @returns Ticks remaining, or `null` in the lobby, which has no clock.
 */
export function ticksLeft(state: MatchState, tick: number): number | null {
  const length = PHASE_TICKS[state.phase];
  if (length === null) return null;
  return Math.max(0, length - (tick - state.since));
}

/**
 * Seconds left in the current phase, rounded up so the last second is shown as 1 rather than 0.
 *
 * @param state - The current phase.
 * @param tick - The simulation tick now.
 * @returns Seconds remaining, or `null` in the lobby.
 */
export function secondsLeft(state: MatchState, tick: number): number | null {
  const left = ticksLeft(state, tick);
  return left === null ? null : Math.ceil(left / HOST_TICK_HZ);
}

/**
 * The number a counting-down player sees: 3, 2, 1 and then nothing.
 *
 * @param state - The current phase.
 * @param tick - The simulation tick now.
 * @returns The count, or `null` outside the countdown.
 */
export function countdownNumber(
  state: MatchState,
  tick: number,
): number | null {
  if (state.phase !== "countdown") return null;
  const seconds = secondsLeft(state, tick);
  return seconds === null || seconds <= 0 ? null : seconds;
}

/** Whether the simulation should be accepting player input in this phase. */
export function acceptsInput(phase: MatchPhase): boolean {
  // The city runs in the lobby (spec §2), and stays alive on the scoreboard so the world does not
  // freeze while scores are read. Only the countdown holds everyone still.
  return phase !== "countdown";
}
