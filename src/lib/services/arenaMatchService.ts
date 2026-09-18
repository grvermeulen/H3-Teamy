import { prisma } from "../db";
import { PostMatchSchema, type PostMatchBody } from "../schemas/arena";
import { ROOM_RULES } from "../cityArena/net/roomProtocol";
import {
  arenaScore,
  compareArenaScores,
  isArenaWinner,
} from "../cityArena/scoring";
import { validRoundReceipts } from "../cityArena/missions/receipts";
import {
  ArenaRoomError,
  lockArenaRoom,
  requireArenaMember,
  type ArenaMemberOwner,
} from "./arenaRoomService";

/** A completed casual match; solo practice completes without entering the leaderboard. */
export type RecordOutcome = {
  matchId: string | null;
  recorded: number;
  verification: "host-reported";
};

/** Records one server-owned round with its original roster and server timestamps. */
export async function recordMatch(
  posterUserId: ArenaMemberOwner,
  input: PostMatchBody,
  now = new Date(),
): Promise<RecordOutcome> {
  const parsed = PostMatchSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const member = await requireArenaMember(tx, parsed.memberId, posterUserId);
    const room = await lockArenaRoom(tx, member.roomId, now);
    await requireArenaMember(tx, parsed.memberId, posterUserId);
    if (
      room.hostMemberId !== member.id ||
      room.hostEpoch !== parsed.epoch ||
      room.hostLeaseUntil <= now
    ) {
      throw new ArenaRoomError(
        "not-host",
        403,
        "Alleen de huidige host kan de uitslag opsturen",
      );
    }
    const round = await tx.arenaRound.findUnique({
      where: { id: parsed.roundId },
      include: { participants: true },
    });
    if (!round || round.roomId !== room.id)
      throw new ArenaRoomError(
        "unknown-match",
        404,
        "Dit potje is niet gestart",
      );
    if (round.completedAt) {
      const existing = await tx.arenaMatch.findUnique({
        where: { roundId: round.id },
        include: { _count: { select: { results: true } } },
      });
      return {
        matchId: existing?.id ?? null,
        recorded: existing?._count.results ?? 0,
        verification: "host-reported",
      };
    }
    if (
      now < round.finishesAt ||
      now.getTime() > round.finishesAt.getTime() + ROOM_RULES.completionGraceMs
    ) {
      throw new ArenaRoomError(
        "invalid-duration",
        422,
        "Het potje is nog niet afgelopen of de uitslag is verlopen",
      );
    }
    const roster = new Map(
      round.participants.map((entry) => [entry.memberId, entry.userId]),
    );
    if (
      parsed.results.length !== roster.size ||
      parsed.results.some((result) => !roster.has(result.memberId))
    ) {
      throw new ArenaRoomError(
        "invalid-roster",
        422,
        "De uitslag moet alle deelnemers van dit potje bevatten",
      );
    }
    const version = round.scoringVersion ?? 1;
    const contracts = new Set<string>();
    for (const result of parsed.results) {
      const receipts = result.receipts ?? [];
      const cash = result.cashEarned ?? 0;
      const count = result.missionsCompleted ?? 0;
      if (
        (version === 1 &&
          (cash !== 0 || count !== 0 || receipts.length !== 0)) ||
        cash !== receipts.reduce((sum, receipt) => sum + receipt.total, 0) ||
        count !== receipts.length ||
        !validRoundReceipts(
          receipts,
          room.zone,
          (round.finishesAt.getTime() - round.startedAt.getTime()) / 1000,
        ) ||
        receipts.some((receipt) => contracts.has(receipt.contractId))
      ) {
        throw new ArenaRoomError(
          "invalid-rewards",
          422,
          "De missiebeloningen kloppen niet met de uitslag",
        );
      }
      for (const receipt of receipts) contracts.add(receipt.contractId);
    }
    const ranked = [...parsed.results].sort((a, b) =>
      compareArenaScores(a, b, version),
    );
    const best = ranked[0]!;
    if (
      parsed.results.some(
        (row) => row.won !== isArenaWinner(row, best, version),
      )
    ) {
      throw new ArenaRoomError(
        "invalid-winner",
        422,
        "De winnaar klopt niet met de uitslag",
      );
    }
    let matchId: string | null = null;
    if (parsed.results.length >= 2) {
      const match = await tx.arenaMatch.create({
        data: {
          roundId: round.id,
          roomCode: room.code,
          zone: room.zone,
          startedAt: round.startedAt,
          endedAt: round.finishesAt,
          hostUserId: typeof posterUserId === "string" ? posterUserId : null,
          verification: "host-reported",
          scoringVersion: version,
          results: {
            create: parsed.results.map((result) => ({
              userId: roster.get(result.memberId)!,
              kills: result.kills,
              deaths: result.deaths,
              won: result.won,
              cashEarned: result.cashEarned ?? 0,
              missionsCompleted: result.missionsCompleted ?? 0,
              score: arenaScore(result, version),
              scoringVersion: version,
              receipts: result.receipts ?? [],
            })),
          },
        },
        select: { id: true },
      });
      matchId = match.id;
    }
    await tx.arenaRound.update({
      where: { id: round.id },
      data: { completedAt: now },
    });
    return {
      matchId,
      recorded: matchId ? parsed.results.length : 0,
      verification: "host-reported",
    };
  });
}

/** One line of the ranglijst. */
export type LeaderboardRow = {
  userId: string;
  firstName: string;
  wins: number;
  kills: number;
  deaths: number;
  score: number;
  cashEarned: number;
  missionsCompleted: number;
};

/** How many players the ranglijst shows (spec §2). */
export const LEADERBOARD_SIZE = 10;

/**
 * The ranglijst: wins, earned points and cash within one scoring version.
 *
 * @param limit - How many rows to return.
 * @returns The ranked rows, longest-standing player first on a complete tie.
 */
export async function leaderboard(
  limit = LEADERBOARD_SIZE,
  scoringVersion: 1 | 2 = 2,
): Promise<LeaderboardRow[]> {
  // Aggregate in PostgreSQL so reading the top ten does not load every player's history.
  const rows = await prisma.$queryRaw<
    {
      userId: string;
      wins: bigint;
      kills: bigint;
      deaths: bigint;
      score: bigint;
      cashEarned: bigint;
      missionsCompleted: bigint;
    }[]
  >`
    SELECT "userId",
           SUM(CASE WHEN "won" THEN 1 ELSE 0 END) AS "wins",
           SUM("kills") AS "kills",
           SUM("deaths") AS "deaths",
           SUM("score") AS "score",
           SUM("cashEarned") AS "cashEarned",
           SUM("missionsCompleted") AS "missionsCompleted"
    FROM "ArenaMatchResult"
    WHERE "scoringVersion" = ${scoringVersion}
    GROUP BY "userId"
    ORDER BY "wins" DESC, "score" DESC, "cashEarned" DESC, "userId" ASC
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
    score: Number(row.score ?? 0),
    cashEarned: Number(row.cashEarned ?? 0),
    missionsCompleted: Number(row.missionsCompleted ?? 0),
  }));
}
