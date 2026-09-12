import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COUNTDOWN_TICKS,
  MATCH_TICKS,
  type MatchState,
} from "@/lib/cityArena/net/matchPhase";
import { emptyTally, type Tally } from "@/lib/cityArena/net/scoreboard";
import type { ArenaPlayerState } from "@/lib/cityArena/sim/types";
import type { ArenaGame, MatchPeek } from "./useArenaGame";
import { useMatchClock, type MatchRecording } from "./useMatchClock";
import { roomTicket } from "@/lib/cityArena/net/roomProtocol.testFixtures";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

/** The slice of ArenaGame the clock touches, over a tick and a host clock the test controls. */
type FakeGame = ArenaGame & {
  tick: number;
  tally: Tally;
  /** What the host's snapshot says, or null when this game decides for itself. */
  match: MatchState | null;
};

/** A fake game whose tick, tally and host clock the test sets directly. */
function fakeGame(): FakeGame {
  const game = {
    tick: 0,
    tally: emptyTally(),
    match: null as MatchState | null,
    resetTally: vi.fn(function (this: { tally: Tally }) {
      game.tally = emptyTally();
    }),
    setMatch: vi.fn(),
    peek(): MatchPeek {
      return {
        tick: game.tick,
        tally: game.tally,
        players: [{ id: 0 } as ArenaPlayerState],
        youId: 0,
        seats: new Map([["me", 0]]),
        match: game.match,
      };
    },
  };
  return game as unknown as FakeGame;
}

const RECORDING: MatchRecording = {
  roomCode: "7K4M2Q",
  zone: "wageningen",
  isHost: false,
};

describe("useMatchClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses server time and lets a new host finish the captured round after migration", async () => {
    vi.setSystemTime(10_000);
    const game = fakeGame();
    const ticket = {
      ...roomTicket(),
      round: {
        id: "33333333-3333-4333-8333-333333333333",
        startedAt: 9000,
        finishesAt: 11_000,
        completedAt: null,
      },
    };
    const send = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", send);
    const { result, rerender } = renderHook(
      ({ isHost, epoch }) =>
        useMatchClock(game, {
          ...RECORDING,
          isHost,
          ticket: { ...ticket, epoch },
        }),
      { initialProps: { isHost: false, epoch: 1 } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.phase).toBe("playing");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(result.current.phase).toBe("scoreboard");
    expect(send).not.toHaveBeenCalled();
    rerender({ isHost: true, epoch: 2 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0]![1].body)).toMatchObject({
      roundId: ticket.round.id,
      epoch: 2,
    });
  });

  it("retains a failed result for an idempotent user retry", async () => {
    vi.setSystemTime(20_000);
    const ticket = {
      ...roomTicket(),
      round: {
        id: "33333333-3333-4333-8333-333333333333",
        startedAt: 1000,
        finishesAt: 10_000,
        completedAt: null,
      },
    };
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Tijdelijk niet beschikbaar" }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", send);
    const { result } = renderHook(() =>
      useMatchClock(fakeGame(), { ...RECORDING, isHost: true, ticket }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.error).toBe("Tijdelijk niet beschikbaar");
    await act(async () => {
      result.current.retryResult();
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![1].body).toBe(send.mock.calls[0]![1].body);
    expect(result.current.error).toBeNull();
  });

  it("starts in the lobby and moves to the countdown when told to start", async () => {
    const game = fakeGame();
    const { result } = renderHook(() => useMatchClock(game, RECORDING));
    expect(result.current.phase).toBe("lobby");
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.phase).toBe("countdown");
    expect(result.current.countdown).toBe(3);
  });
  it("does not show an extra countdown number under clock-offset uncertainty", () => {
    const now = Date.now();
    const ticket = roomTicket({
      round: {
        id: "44444444-4444-4444-8444-444444444444",
        startedAt: now + 3000,
        finishesAt: now + 183000,
        completedAt: null,
      },
    });
    const { result } = renderHook(() =>
      useMatchClock(fakeGame(), { ...RECORDING, ticket, clockOffsetMs: -400 }),
    );
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.countdown).toBe(3);
  });

  it("clears the tally when a potje starts, so a rematch does not inherit the last one", async () => {
    // The runtime accumulates kills for as long as the overlay is open. Without the reset the
    // second potje's scorebord would carry the first one's kills and deaths.
    const game = fakeGame();
    const { result } = renderHook(() => useMatchClock(game, RECORDING));
    await act(async () => {
      await result.current.start();
    });
    expect(game.resetTally).toHaveBeenCalledTimes(1);
  });

  it("follows the simulation tick through countdown, match and scorebord", async () => {
    const game = fakeGame();
    const { result } = renderHook(() => useMatchClock(game, RECORDING));
    await act(async () => {
      await result.current.start();
    });
    game.tick = COUNTDOWN_TICKS;
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.phase).toBe("playing");
    game.tick = COUNTDOWN_TICKS + MATCH_TICKS;
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.phase).toBe("scoreboard");
    expect(result.current.scoreboard).toHaveLength(1);
  });

  it("returns to the lobby on request and forgets the scorebord", async () => {
    const game = fakeGame();
    const { result } = renderHook(() => useMatchClock(game, RECORDING));
    await act(async () => {
      await result.current.start();
    });
    game.tick = COUNTDOWN_TICKS + MATCH_TICKS;
    act(() => {
      vi.advanceTimersByTime(150);
    });
    act(() => result.current.backToLobby());
    expect(result.current.phase).toBe("lobby");
    expect(result.current.scoreboard).toEqual([]);
  });

  it("tells the game about every transition, so the host's snapshot carries it", async () => {
    const game = fakeGame();
    const { result } = renderHook(() => useMatchClock(game, RECORDING));
    await act(async () => {
      await result.current.start();
    });
    expect(game.setMatch).toHaveBeenCalledWith({
      phase: "countdown",
      since: 0,
    });
    game.tick = COUNTDOWN_TICKS;
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(game.setMatch).toHaveBeenLastCalledWith({
      phase: "playing",
      since: COUNTDOWN_TICKS,
    });
  });

  it("follows the host's clock when the snapshot carries one, without being started", async () => {
    // A client never presses start: the host's snapshot says where the potje is, and the client
    // draws that. Stepping its own clock too would let the two disagree.
    const game = fakeGame();
    const { result } = renderHook(() => useMatchClock(game, RECORDING));
    game.match = { phase: "countdown", since: 0 };
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.phase).toBe("countdown");
    expect(result.current.countdown).toBe(3);
    game.match = { phase: "scoreboard", since: COUNTDOWN_TICKS + MATCH_TICKS };
    game.tick = COUNTDOWN_TICKS + MATCH_TICKS;
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.phase).toBe("scoreboard");
    expect(result.current.scoreboard).toHaveLength(1);
  });

  it("remembers who held which player when the potje ended", async () => {
    const game = fakeGame();
    const { result } = renderHook(() => useMatchClock(game, RECORDING));
    await act(async () => {
      await result.current.start();
    });
    game.tick = COUNTDOWN_TICKS;
    act(() => {
      vi.advanceTimersByTime(150);
    });
    game.tick = COUNTDOWN_TICKS + MATCH_TICKS;
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.accounts.get(0)).toBe("me");
    act(() => result.current.backToLobby());
    expect(result.current.accounts.size).toBe(0);
  });
});
