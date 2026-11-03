import { prisma } from "../db";
import { displayName } from "../userUtils";

/** A player's question about a drill. */
export type DrillQuestionView = {
  id: string;
  text: string;
  createdAt: string;
  resolvedAt: string | null;
  /** Display name of the asker; only filled for trainers. */
  askedBy: string | null;
  mine: boolean;
};

/** What the drill detail page needs to render the "Ik snap 'm" footer and the questions. */
export type DrillEngagement = {
  ackCount: number;
  acked: boolean;
  questions: DrillQuestionView[];
};

/**
 * Ack count, whether `userId` acked, and questions: the viewer's own ones, or
 * every open question when `isTrainer`.
 *
 * @param drillId - Drill slug.
 * @param userId - Viewer, or `null` when anonymous.
 * @param isTrainer - Whether the viewer may see all questions and who asked them.
 */
export async function getDrillEngagement(
  drillId: string,
  userId: string | null,
  isTrainer: boolean,
): Promise<DrillEngagement> {
  const [ackCount, mine, questions] = await Promise.all([
    prisma.drillAck.count({ where: { drillId } }),
    userId
      ? prisma.drillAck.findUnique({
          where: { drillId_userId: { drillId, userId } },
          select: { id: true },
        })
      : null,
    prisma.drillQuestion.findMany({
      where: isTrainer
        ? { drillId }
        : userId
          ? { drillId, userId }
          : { drillId, userId: "" },
      select: {
        id: true,
        text: true,
        createdAt: true,
        resolvedAt: true,
        userId: true,
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return {
    ackCount,
    acked: mine !== null,
    questions: questions.map((q) => ({
      id: q.id,
      text: q.text,
      createdAt: q.createdAt.toISOString(),
      resolvedAt: q.resolvedAt?.toISOString() ?? null,
      askedBy: isTrainer ? displayName(q.user) : null,
      mine: q.userId === userId,
    })),
  };
}

/**
 * Sets or clears the viewer's "Ik snap 'm" for a drill.
 *
 * @returns The new ack count.
 */
export async function setDrillAck(
  drillId: string,
  userId: string,
  acked: boolean,
): Promise<number> {
  if (acked) {
    await prisma.drillAck.upsert({
      where: { drillId_userId: { drillId, userId } },
      create: { drillId, userId },
      update: {},
    });
  } else {
    await prisma.drillAck.deleteMany({ where: { drillId, userId } });
  }
  return prisma.drillAck.count({ where: { drillId } });
}

/** Drill ids the user has acked, for badges in the library. */
export async function listAckedDrillIds(userId: string): Promise<string[]> {
  const rows = await prisma.drillAck.findMany({
    where: { userId },
    select: { drillId: true },
    take: 500,
  });
  return rows.map((r) => r.drillId);
}

/** Ack count per drill id, for the trainer's programme view. */
export async function ackCountsByDrill(
  drillIds: string[],
): Promise<Record<string, number>> {
  if (drillIds.length === 0) return {};
  const groups = await prisma.drillAck.groupBy({
    by: ["drillId"],
    where: { drillId: { in: drillIds } },
    _count: { _all: true },
  });
  return Object.fromEntries(groups.map((g) => [g.drillId, g._count._all]));
}

/** Stores a player's question about a drill. */
export async function askDrillQuestion(
  drillId: string,
  userId: string,
  text: string,
): Promise<DrillQuestionView> {
  const q = await prisma.drillQuestion.create({
    data: { drillId, userId, text },
    select: { id: true, text: true, createdAt: true },
  });
  return {
    id: q.id,
    text: q.text,
    createdAt: q.createdAt.toISOString(),
    resolvedAt: null,
    askedBy: null,
    mine: true,
  };
}

/**
 * Marks a question as handled (trainer action).
 *
 * @returns `false` when the question does not belong to the drill.
 */
export async function resolveDrillQuestion(
  drillId: string,
  questionId: string,
): Promise<boolean> {
  const result = await prisma.drillQuestion.updateMany({
    where: { id: questionId, drillId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  return result.count > 0;
}
