"use client";

/**
 * The seam between the match clock and the running simulation.
 *
 * The clock and the scorebord need the tick, the tally and the phase, which change thirty times a
 * second. Pushing that through React state would re-render the whole overlay every tick, so the
 * clock polls this at whatever rate it actually needs instead, and writes back through it.
 */

import { useCallback, type RefObject } from "react";
import type { MatchState } from "@/lib/cityArena/net/matchPhase";
import { emptyTally, type Tally } from "@/lib/cityArena/net/scoreboard";
import type { ArenaPlayerState } from "@/lib/cityArena/sim/types";
import { myPlayerId, type Runtime } from "./arenaRuntime";

/** What {@link MatchSeam.peek} reports about the running simulation. */
export type MatchPeek = {
  tick: number;
  tally: Tally;
  players: ArenaPlayerState[];
  youId: number;
  /** Client id to player id, as the host seated them; empty when running alone. */
  seats: ReadonlyMap<string, number>;
  /** Where the host says the potje is, or `null` when this client decides for itself. */
  match: MatchState | null;
};

/** What the match clock reads from, and writes into, the simulation. */
export type MatchSeam = {
  /**
   * Clears the kill tally, so a rematch starts from zero rather than carrying the last potje's
   * kills and deaths into the next scorebord.
   */
  resetTally(): void;
  /**
   * Reads the live simulation without subscribing to it.
   *
   * @returns The tick, the tally, the players and the seats, or `null` before the world booted.
   */
  peek(): MatchPeek | null;
  /**
   * Tells the room where the potje is. Only the host's clock decides (spec §2): while this
   * client hosts, the state rides on every snapshot; otherwise this does nothing.
   */
  setMatch(match: MatchState): void;
};

/**
 * The seam over the runtime ref.
 *
 * @param runtimeRef - The runtime, or null before the world has booted.
 * @returns Stable callbacks the match clock can hold on to.
 */
export function useMatchSeam(runtimeRef: RefObject<Runtime | null>): MatchSeam {
  const resetTally = useCallback((): void => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.tally = emptyTally();
    if (runtime.netplay.kind === "host") runtime.netplay.loop.resetTally();
  }, [runtimeRef]);

  const peek = useCallback((): MatchPeek | null => {
    const runtime = runtimeRef.current;
    if (!runtime) return null;
    const net = runtime.netplay;
    return {
      tick: runtime.state.tick,
      tally: runtime.tally,
      players: runtime.state.players,
      youId: myPlayerId(runtime),
      seats: net.kind === "offline" ? new Map() : net.loop.seats(),
      match: net.kind === "client" ? net.loop.match() : null,
    };
  }, [runtimeRef]);

  const setMatch = useCallback(
    (match: MatchState): void => {
      const runtime = runtimeRef.current;
      if (runtime?.netplay.kind === "host")
        runtime.netplay.loop.setMatch(match);
    },
    [runtimeRef],
  );

  return { resetTally, peek, setMatch };
}
