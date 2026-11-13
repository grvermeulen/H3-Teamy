import { prisma } from "../db";
import type { Drill, ProgramItemInput } from "../schemas/speelboek";
import { toYMD } from "../training";
import { getAllDrills } from "./speelboekService";

/** One programme line with its drill resolved (null when the drill no longer exists). */
export type ProgramItem = {
  id: string;
  drillId: string;
  position: number;
  minutes: number | null;
  note: string | null;
  drill: Drill | null;
};

/** Programme for one training date. */
export type TrainingProgram = {
  date: string;
  items: ProgramItem[];
};

/** How far ahead the library looks for the next programme to show players. */
export const UPCOMING_PROGRAM_WINDOW_DAYS = 14;

async function resolveItems(
  rows: {
    id: string;
    drillId: string;
    position: number;
    minutes: number | null;
    note: string | null;
  }[],
  includeDrafts: boolean,
): Promise<ProgramItem[]> {
  const all = await getAllDrills(includeDrafts);
  const byId = new Map(all.map((d) => [d.id, d]));
  return rows.map((r) => ({ ...r, drill: byId.get(r.drillId) ?? null }));
}

/** Unique training dates in first-seen order (matches legacy getUpcomingProgram scan). */
function distinctTrainingDates(dateRows: { date: string }[]): string[] {
  const dates: string[] = [];
  const seen = new Set<string>();
  for (const row of dateRows) {
    if (seen.has(row.date)) continue;
    seen.add(row.date);
    dates.push(row.date);
  }
  return dates;
}

/** Validates drill slugs with one library load instead of per-id lookups. */
async function drillIdsExist(
  drillIds: string[],
  includeDrafts: boolean,
): Promise<boolean> {
  if (drillIds.length === 0) return true;
  const all = await getAllDrills(includeDrafts);
  const byId = new Map(all.map((d) => [d.id, d]));
  return drillIds.every((id) => byId.has(id));
}

/**
 * Programme for a training date, in order.
 *
 * @param date - `YYYY-MM-DD`.
 * @param includeDrafts - Resolve unpublished trainer drills too (trainer view).
 */
export async function getProgram(
  date: string,
  includeDrafts = true,
): Promise<TrainingProgram> {
  const rows = await prisma.trainingProgramItem.findMany({
    where: { date },
    select: {
      id: true,
      drillId: true,
      position: true,
      minutes: true,
      note: true,
    },
    orderBy: { position: "asc" },
  });
  return { date, items: await resolveItems(rows, includeDrafts) };
}

/**
 * Replaces the programme for a date. Unknown drill ids are rejected.
 *
 * @param date - `YYYY-MM-DD`.
 * @param items - Drills in the desired order.
 * @returns The saved programme, or `null` when an item refers to an unknown drill.
 */
export async function setProgram(
  date: string,
  items: ProgramItemInput[],
): Promise<TrainingProgram | null> {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.drillId)) return null;
    seen.add(item.drillId);
  }
  if (
    !(await drillIdsExist(
      items.map((item) => item.drillId),
      true,
    ))
  ) {
    return null;
  }
  await prisma.$transaction([
    prisma.trainingProgramItem.deleteMany({ where: { date } }),
    prisma.trainingProgramItem.createMany({
      data: items.map((item, position) => ({
        date,
        drillId: item.drillId,
        position,
        minutes: item.minutes ?? null,
        note: item.note || null,
      })),
    }),
  ]);
  return getProgram(date);
}

/**
 * The first training date on or after today that has a programme, within
 * {@link UPCOMING_PROGRAM_WINDOW_DAYS}. This feeds "Vanavond oefenen we" in the library.
 *
 * @param now - Reference time.
 * @returns The programme, or `null` when nothing is planned.
 */
export async function getUpcomingProgram(
  now: Date = new Date(),
): Promise<TrainingProgram | null> {
  const from = toYMD(now);
  const to = toYMD(
    new Date(
      now.getTime() + UPCOMING_PROGRAM_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ),
  );
  const dateRows = await prisma.trainingProgramItem.findMany({
    where: { date: { gte: from, lte: to } },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  if (dateRows.length === 0) return null;
  const datesInOrder = distinctTrainingDates(dateRows);
  const itemRows = await prisma.trainingProgramItem.findMany({
    where: { date: { in: datesInOrder } },
    select: {
      id: true,
      date: true,
      drillId: true,
      position: true,
      minutes: true,
      note: true,
    },
    orderBy: [{ date: "asc" }, { position: "asc" }],
  });
  const drills = await getAllDrills(false);
  const drillById = new Map(drills.map((d) => [d.id, d]));
  for (const date of datesInOrder) {
    const rows = itemRows.filter((row) => row.date === date);
    const items: ProgramItem[] = rows.map((row) => ({
      id: row.id,
      drillId: row.drillId,
      position: row.position,
      minutes: row.minutes,
      note: row.note,
      drill: drillById.get(row.drillId) ?? null,
    }));
    const published = items.filter((item) => item.drill !== null);
    if (published.length > 0) {
      return { date, items: published };
    }
  }
  return null;
}
