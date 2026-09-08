/**
 * The scorebord: who killed whom over one potje.
 *
 * Kills and deaths come from two different places on purpose.
 *
 * A **kill** is read from the `kill` event, because the shot that finishes someone is the only
 * moment the killer is known — health reaching zero says nothing about who did it.
 *
 * A **death** is read from the same event too, which means a player who dies with no killer (an
 * exploding car, a fall, the zone rule) still has it counted: those events carry `killerId: null`
 * rather than being omitted. Counting deaths from health transitions instead would double-count a
 * player who is killed on the same tick the host also respawns them.
 */

import type { ArenaEvent, ArenaPlayerState } from "../sim/types";

/** One player's line on the scoreboard. */
export type ScoreRow = {
  playerId: number;
  kills: number;
  deaths: number;
};

/** Kills and deaths so far, by player id. */
export type Tally = ReadonlyMap<number, ScoreRow>;

/** An empty tally, which is what a potje starts from. */
export function emptyTally(): Tally {
  return new Map();
}

/** The row for `playerId`, created empty when this is their first entry. */
function rowFor(tally: Map<number, ScoreRow>, playerId: number): ScoreRow {
  const existing = tally.get(playerId);
  if (existing) return existing;
  const created: ScoreRow = { playerId, kills: 0, deaths: 0 };
  tally.set(playerId, created);
  return created;
}

/**
 * Folds one tick's events into the tally.
 *
 * A player who kills themselves — their own grenade, their own car — takes the death and no
 * kill. Rewarding a suicide with a point would make the fastest route up the scoreboard a
 * self-destruct.
 *
 * @param tally - The tally so far; not modified.
 * @param events - This tick's events.
 * @returns The tally including this tick.
 */
export function tallyEvents(tally: Tally, events: ArenaEvent[]): Tally {
  const next = new Map(
    [...tally].map(([id, row]) => [id, { ...row }] as const),
  );
  for (const event of events) {
    if (event.kind !== "kill" || event.victim !== "player") continue;
    if (event.victimId !== null) rowFor(next, event.victimId).deaths += 1;
    if (event.killerId !== null && event.killerId !== event.victimId)
      rowFor(next, event.killerId).kills += 1;
  }
  return next;
}

/** A scoreboard line, ready to render. */
export type ScoreLine = ScoreRow & {
  /** True for the player reading the screen. */
  isYou: boolean;
  /** True for whoever is top; a shared top means several winners, which is honest. */
  isWinner: boolean;
};

/**
 * The scoreboard in ranking order: most kills first, then fewest deaths, then lowest id.
 *
 * The final tie-break on id is what stops two clients rendering the same scores in a different
 * order, the same reason host election never falls through to array order.
 *
 * @param tally - The tally at the end of the potje.
 * @param players - Everyone in the match; players with no kills or deaths still get a line.
 * @param youId - The reading player's id.
 * @returns The ranked lines.
 */
export function rankScoreboard(
  tally: Tally,
  players: ArenaPlayerState[],
  youId: number,
): ScoreLine[] {
  const rows = players.map(
    (player) =>
      tally.get(player.id) ?? { playerId: player.id, kills: 0, deaths: 0 },
  );
  const ranked = [...rows].sort((first, second) => {
    if (first.kills !== second.kills) return second.kills - first.kills;
    if (first.deaths !== second.deaths) return first.deaths - second.deaths;
    return first.playerId - second.playerId;
  });
  const best = ranked[0];
  // Nobody "wins" a potje in which not a single kill was scored.
  const winning = best && best.kills > 0 ? best : null;
  return ranked.map((row) => ({
    ...row,
    isYou: row.playerId === youId,
    isWinner:
      winning !== null &&
      row.kills === winning.kills &&
      row.deaths === winning.deaths,
  }));
}
