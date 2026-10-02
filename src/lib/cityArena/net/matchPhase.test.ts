import { describe, expect, it } from "vitest";
import { HOST_TICK_HZ } from "./hostLoop";
import {
  COUNTDOWN_TICKS,
  MATCH_TICKS,
  SCOREBOARD_TICKS,
  acceptsInput,
  beginCountdown,
  countdownNumber,
  lobbyMatch,
  secondsLeft,
  stepMatch,
  ticksLeft,
  type MatchState,
} from "./matchPhase";

/** Runs the machine from `state` to `tick`, one tick at a time, as the host does. */
function runTo(state: MatchState, from: number, to: number): MatchState {
  let current = state;
  for (let tick = from; tick <= to; tick += 1)
    current = stepMatch(current, tick);
  return current;
}

describe("match phases", () => {
  it("waits in the lobby indefinitely, because the host decides, not a clock", () => {
    const after = runTo(lobbyMatch(), 0, MATCH_TICKS * 2);
    expect(after.phase).toBe("lobby");
    expect(ticksLeft(after, 99999)).toBeNull();
    expect(secondsLeft(after, 99999)).toBeNull();
  });

  it("runs lobby → countdown → playing → scoreboard → lobby", () => {
    let state = beginCountdown(0);
    expect(state.phase).toBe("countdown");

    state = runTo(state, 1, COUNTDOWN_TICKS);
    expect(state.phase).toBe("playing");

    state = runTo(state, COUNTDOWN_TICKS + 1, COUNTDOWN_TICKS + MATCH_TICKS);
    expect(state.phase).toBe("scoreboard");

    const scoreboardEnd = COUNTDOWN_TICKS + MATCH_TICKS + SCOREBOARD_TICKS;
    state = runTo(state, COUNTDOWN_TICKS + MATCH_TICKS + 1, scoreboardEnd);
    expect(state.phase).toBe("lobby");
  });

  it("holds each phase for exactly its length, not a tick less", () => {
    const countdown = beginCountdown(0);
    expect(stepMatch(countdown, COUNTDOWN_TICKS - 1).phase).toBe("countdown");
    expect(stepMatch(countdown, COUNTDOWN_TICKS).phase).toBe("playing");
  });

  it("advances one phase at a time even after a long freeze", () => {
    // A host that stalled for a minute must not skip the whole potje in one tick.
    const stalled = stepMatch(beginCountdown(0), MATCH_TICKS * 10);
    expect(stalled.phase).toBe("playing");
  });

  it("counts the countdown down 3, 2, 1 and then stops", () => {
    const state = beginCountdown(0);
    expect(countdownNumber(state, 0)).toBe(3);
    expect(countdownNumber(state, HOST_TICK_HZ)).toBe(2);
    expect(countdownNumber(state, HOST_TICK_HZ * 2)).toBe(1);
    expect(countdownNumber(state, COUNTDOWN_TICKS)).toBeNull();
  });

  it("shows the final second as 1 rather than rounding it away", () => {
    const state = beginCountdown(0);
    expect(countdownNumber(state, COUNTDOWN_TICKS - 1)).toBe(1);
  });

  it("has no countdown number outside the countdown", () => {
    expect(countdownNumber(lobbyMatch(), 0)).toBeNull();
    expect(countdownNumber({ phase: "playing", since: 0 }, 10)).toBeNull();
  });

  it("reports the time left in a match", () => {
    const playing: MatchState = { phase: "playing", since: 100 };
    expect(secondsLeft(playing, 100)).toBe(180);
    expect(secondsLeft(playing, 100 + HOST_TICK_HZ * 60)).toBe(120);
    expect(ticksLeft(playing, 100 + MATCH_TICKS)).toBe(0);
  });

  it("never reports negative time left", () => {
    const playing: MatchState = { phase: "playing", since: 0 };
    expect(ticksLeft(playing, MATCH_TICKS * 3)).toBe(0);
    expect(secondsLeft(playing, MATCH_TICKS * 3)).toBe(0);
  });

  it("holds everyone still during the countdown and nowhere else", () => {
    // The city keeps running in the lobby (spec §2) and on the scoreboard, so the world does not
    // freeze while scores are read. Only the countdown stops play.
    expect(acceptsInput("countdown")).toBe(false);
    expect(acceptsInput("lobby")).toBe(true);
    expect(acceptsInput("playing")).toBe(true);
    expect(acceptsInput("scoreboard")).toBe(true);
  });

  it("matches the durations the spec gives", () => {
    expect(COUNTDOWN_TICKS).toBe(3 * HOST_TICK_HZ);
    expect(MATCH_TICKS).toBe(180 * HOST_TICK_HZ);
    expect(SCOREBOARD_TICKS).toBe(10 * HOST_TICK_HZ);
  });
});
