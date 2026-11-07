import * as Sentry from "@sentry/nextjs";
import type { PrismaClient } from "@prisma/client";
import type { TeamEvent } from "../../types";

export type TeamEventDbClient = Pick<PrismaClient, "event">;

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
    Sentry.captureException(
      err instanceof Error ? err : new Error(String(err)),
      { tags: { source: "event_db_fallback" } },
    );
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

  await Promise.all(
    persistable.map((e) =>
      prisma.event.upsert({
        where: { id: e.id },
        create: {
          id: e.id,
          title: e.title,
          description: e.description ?? null,
          startDate: new Date(e.start),
          endDate: e.end ? new Date(e.end) : null,
        },
        update: {
          title: e.title,
          description: e.description ?? null,
          startDate: new Date(e.start),
          endDate: e.end ? new Date(e.end) : null,
        },
      }),
    ),
  );

  return persistable.length;
}
