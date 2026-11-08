import * as Sentry from "@sentry/nextjs";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { TeamEvent } from "../../types";
import { isDbUnavailableError } from "../dbUnavailableError";
import { isTransientPrismaConnectSentryNoise } from "../sentryTransientPrismaConnectNoise";

export type TeamEventDbClient = Pick<PrismaClient, "event" | "$executeRaw">;

/**
 * Returns calendar events from Postgres that have complete display metadata.
 */
export async function fetchTeamEventsFromDb(
  prisma: TeamEventDbClient,
): Promise<TeamEvent[]> {
  try {
    const rows = await prisma.event.findMany({
      where: { title: { not: null }, startDate: { not: null } },
      orderBy: { startDate: "asc" },
    });
    return rows
      .filter((r) => r.title && r.startDate)
      .map((r) => ({
        id: r.id,
        title: r.title!,
        start: r.startDate!.toISOString(),
        end: r.endDate?.toISOString(),
        description: r.description ?? undefined,
      }));
  } catch (err: unknown) {
    if (
      !isDbUnavailableError(err) &&
      !isTransientPrismaConnectSentryNoise(err)
    ) {
      Sentry.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { tags: { source: "event_db_fallback" } },
      );
    }
    return [];
  }
}

/** Whether the event can be shown in the match list and persisted. */
export function isPersistableTeamEvent(event: TeamEvent): boolean {
  return Boolean(event.title?.trim() && event.start?.trim());
}

/**
 * Events in `candidates` whose id or metadata differs from what Postgres already has.
 */
export function teamEventsNeedingDbPersist(
  candidates: TeamEvent[],
  dbEvents: TeamEvent[],
): TeamEvent[] {
  const dbById = new Map(dbEvents.map((e) => [e.id, e]));
  return candidates.filter((e) => {
    if (!isPersistableTeamEvent(e)) return false;
    const existing = dbById.get(e.id);
    if (!existing) return true;
    return (
      existing.start !== e.start ||
      existing.title !== e.title ||
      (existing.end ?? null) !== (e.end ?? null) ||
      (existing.description ?? null) !== (e.description ?? null)
    );
  });
}

/**
 * Upserts match metadata into `Event` for history when Sportlink drops past fixtures.
 *
 * @returns Number of rows written.
 */
export async function persistTeamEventsToDb(
  prisma: TeamEventDbClient,
  events: TeamEvent[],
): Promise<number> {
  const persistable = events.filter(isPersistableTeamEvent);
  if (persistable.length === 0) return 0;

  const valueRows = persistable.map(
    (e) =>
      Prisma.sql`(${e.id}, ${e.title}, ${e.description ?? null}, ${new Date(e.start)}, ${e.end ? new Date(e.end) : null}, NOW(), NOW())`,
  );

  await prisma.$executeRaw`
    INSERT INTO "Event" ("id", "title", "description", "startDate", "endDate", "createdAt", "updatedAt")
    VALUES ${Prisma.join(valueRows)}
    ON CONFLICT ("id") DO UPDATE SET
      "title" = EXCLUDED."title",
      "description" = EXCLUDED."description",
      "startDate" = EXCLUDED."startDate",
      "endDate" = EXCLUDED."endDate",
      "updatedAt" = NOW()
  `;

  return persistable.length;
}
