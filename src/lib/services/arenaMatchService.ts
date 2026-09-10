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
 * - only the **acting host of a live room** may post: the best-ranked present member heard from
 *   in the room's recent snapshots, else the host the presence election every client runs names
 *   (`net/roomHost.ts`) — so an outsider cannot post for a room at all, and a host that took over
 *   mid-potje is not refused while the old host's presence entry lingers;
 * - only **players who were actually in that room** get a line, so a host cannot award or ruin
 *   stats for someone who never played;
 * - a potje is **idempotent** on `(roomCode, startedAt)`, so a retry after a dropped response
 *   records nothing twice;
 * - counts are bounded, so a bad payload cannot write absurd numbers into a leaderboard.
 */

import * as Ably from "ably";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { resolveRoomHost } from "../cityArena/net/roomHost";

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

/** Clamps a reported count into the bound, so a bad payload cannot poison a leaderboard. */
function bounded(value: number): number {
  return Math.max(0, Math.min(MAX_MATCH_COUNT, Math.round(value)));
}

/**
 * Records a finished potje, if the person posting it is entitled to.
 *
 * @param key - The Ably API key, used to read the room's presence set and history.
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

  const { host, members } = await resolveRoomHost(
    new Ably.Rest({ key }),
    input.roomCode,
  );
  // `clientId` is the user id (spec §6.2), so presence is what says who was really in the room.
  if (host !== posterUserId) return { ok: false, reason: "not-host" };

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

  try {
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
  } catch (error: unknown) {
    // The findUnique above is a check-then-act; two hosts posting the same potje at once can
    // both pass it and race on the unique index. Only *that* collision is "already recorded" —
    // a duplicate userId inside the results would trip the same error code on a different index
    // and must not be mistaken for it.
    if (isMatchAlreadyRecorded(error))
      return { ok: false, reason: "already-recorded" };
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "match-record" },
    });
    throw error;
  }
}

/** True for a unique-constraint violation on the potje itself, `(roomCode, startedAt)`. */
function isMatchAlreadyRecorded(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target)];
  return fields.includes("roomCode") && fields.includes("startedAt");
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
  // Ranked and cut in the database: the ranking uses wins first and kills second, which
  // Prisma's groupBy cannot order by, and pulling every player's totals into memory to sort
  // them here would grow with every potje ever played. The final tie on user id keeps the list
  // stable between requests.
  const rows = await prisma.$queryRaw<
    { userId: string; wins: bigint; kills: bigint; deaths: bigint }[]
  >`
    SELECT "userId",
           SUM(CASE WHEN "won" THEN 1 ELSE 0 END) AS "wins",
           SUM("kills") AS "kills",
           SUM("deaths") AS "deaths"
    FROM "ArenaMatchResult"
    GROUP BY "userId"
    ORDER BY "wins" DESC, "kills" DESC, "userId" ASC
    LIMIT ${limit}`;
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((row) => row.userId) } },
    select: { id: true, firstName: true },
    take: limit,
  });
  const nameBy = new Map(users.map((user) => [user.id, user.firstName]));
  return rows.map((row) => ({
    userId: row.userId,
    firstName: nameBy.get(row.userId)?.trim() || "Speler",
    wins: Number(row.wins),
    kills: Number(row.kills),
    deaths: Number(row.deaths),
  }));
}
