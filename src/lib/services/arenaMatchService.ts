/**
 * Recording a finished potje (spec §9.1, §2 step 4).
 *
 * **Trust model, stated plainly.** GTA H3 is host-authoritative peer play: there is no server
 * simulating the match, so the scores can only come from the host's browser. A determined person
 * hosting a real room can therefore post scores that did not happen. That is inherent to the
 * design, not something this service can close.
 *
 * What it *can* close, and does:
 *
 * - only the **elected host of a live room** may post, checked against Ably's presence set with
 *   the same `electHost` every client runs, so an outsider cannot post for a room at all;
 * - only **players who were actually in that room** get a line, so a host cannot award or ruin
 *   stats for someone who never played;
 * - a potje is **idempotent** on `(roomCode, startedAt)`, so a retry after a dropped response
 *   records nothing twice;
 * - counts are bounded, so a bad payload cannot write absurd numbers into a leaderboard.
 */

import * as Ably from "ably";
import { prisma } from "../db";
import { electHost } from "../cityArena/net/election";
import { roomChannelName } from "../cityArena/net/room";
import type { PresenceMember } from "../cityArena/net/transport";

/** Spec §2 step 4: a potje is only recorded when at least two people played it. */
export const MIN_RECORDED_PLAYERS = 2;

/**
 * The most kills or deaths one player can have in a 180 s potje.
 *
 * A sanity bound, not a rule of the game: it stops a malformed or hostile payload writing an
 * absurd number into a leaderboard, while sitting far above anything reachable in play.
 */
export const MAX_MATCH_COUNT = 200;

/** One player's line, as the host reports it. */
export type MatchResultInput = {
  userId: string;
  kills: number;
  deaths: number;
  won: boolean;
};

/** A finished potje, as the host reports it. */
export type MatchInput = {
  roomCode: string;
  zone: string;
  startedAt: Date;
  endedAt: Date;
  results: MatchResultInput[];
};

/** Why a potje was not recorded. */
export type RecordFailure =
  "not-host" | "too-few-players" | "no-eligible-players" | "already-recorded";

/** What happened to a posted potje. */
export type RecordOutcome =
  | { ok: true; matchId: string; recorded: number }
  | { ok: false; reason: RecordFailure };

/** Reads a room's presence set through Ably's REST API. */
async function presenceOf(
  key: string,
  roomCode: string,
): Promise<PresenceMember[]> {
  const rest = new Ably.Rest({ key });
  const page = await rest.channels
    .get(roomChannelName(roomCode))
    .presence.get();
  return page.items.map((item) => ({
    clientId: item.clientId,
    data: item.data as PresenceMember["data"],
    timestamp: item.timestamp,
  }));
}

/** Clamps a reported count into the bound, so a bad payload cannot poison a leaderboard. */
function bounded(value: number): number {
  return Math.max(0, Math.min(MAX_MATCH_COUNT, Math.round(value)));
}

/**
 * Records a finished potje, if the person posting it is entitled to.
 *
 * @param key - The Ably API key, used to read the room's presence set.
 * @param posterUserId - The signed-in user posting the result.
 * @param input - The potje as the host reports it.
 * @returns What happened, including the reason when nothing was recorded.
 */
export async function recordMatch(
  key: string,
  posterUserId: string,
  input: MatchInput,
): Promise<RecordOutcome> {
  if (input.results.length < MIN_RECORDED_PLAYERS)
    return { ok: false, reason: "too-few-players" };

  const members = await presenceOf(key, input.roomCode);
  // `clientId` is the user id (spec §6.2), so presence is what says who was really in the room.
  if (electHost(members) !== posterUserId)
    return { ok: false, reason: "not-host" };

  const present = new Set(members.map((member) => member.clientId));
  const eligible = input.results.filter((result) => present.has(result.userId));
  if (eligible.length < MIN_RECORDED_PLAYERS)
    return { ok: false, reason: "no-eligible-players" };

  const existing = await prisma.arenaMatch.findUnique({
    where: {
      roomCode_startedAt: {
        roomCode: input.roomCode,
        startedAt: input.startedAt,
      },
    },
    select: { id: true },
  });
  if (existing) return { ok: false, reason: "already-recorded" };

  const match = await prisma.arenaMatch.create({
    data: {
      roomCode: input.roomCode,
      zone: input.zone,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      hostUserId: posterUserId,
      results: {
        create: eligible.map((result) => ({
          userId: result.userId,
          kills: bounded(result.kills),
          deaths: bounded(result.deaths),
          won: result.won,
        })),
      },
    },
    select: { id: true },
  });
  return { ok: true, matchId: match.id, recorded: eligible.length };
}

/** One line of the ranglijst. */
export type LeaderboardRow = {
  userId: string;
  firstName: string;
  wins: number;
  kills: number;
  deaths: number;
};

/** How many players the ranglijst shows (spec §2). */
export const LEADERBOARD_SIZE = 10;

/**
 * The ranglijst: the top players by wins, then kills.
 *
 * @param limit - How many rows to return.
 * @returns The ranked rows, longest-standing player first on a complete tie.
 */
export async function leaderboard(
  limit = LEADERBOARD_SIZE,
): Promise<LeaderboardRow[]> {
  const grouped = await prisma.arenaMatchResult.groupBy({
    by: ["userId"],
    _sum: { kills: true, deaths: true },
    _count: { _all: true },
  });
  const wins = await prisma.arenaMatchResult.groupBy({
    by: ["userId"],
    where: { won: true },
    _count: { _all: true },
  });
  const winsBy = new Map(wins.map((row) => [row.userId, row._count._all]));
  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((row) => row.userId) } },
    select: { id: true, firstName: true },
  });
  const nameBy = new Map(users.map((user) => [user.id, user.firstName]));

  return grouped
    .map((row) => ({
      userId: row.userId,
      firstName: nameBy.get(row.userId)?.trim() || "Speler",
      wins: winsBy.get(row.userId) ?? 0,
      kills: row._sum.kills ?? 0,
      deaths: row._sum.deaths ?? 0,
    }))
    .sort((first, second) => {
      if (first.wins !== second.wins) return second.wins - first.wins;
      if (first.kills !== second.kills) return second.kills - first.kills;
      // A total tie breaks on user id, so the list is stable between requests.
      return first.userId < second.userId ? -1 : 1;
    })
    .slice(0, limit);
}
