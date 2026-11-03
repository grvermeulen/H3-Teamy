import { prisma } from "../db";
import type { Drill, ProgramItemInput } from "../schemas/speelboek";
import { toYMD } from "../training";
import { findDrill, getAllDrills } from "./speelboekService";
import {
  getWaapiAppUrl,
  sendWhatsAppGroupMessage,
  type NotificationResult,
} from "./waapiService";

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
    if (!(await findDrill(item.drillId))) return null;
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
  const first = await prisma.trainingProgramItem.findFirst({
    where: { date: { gte: from, lte: to } },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  if (!first) return null;
  const program = await getProgram(first.date, false);
  program.items = program.items.filter((i) => i.drill !== null);
  return program.items.length > 0 ? program : null;
}

/**
 * Builds the WhatsApp text for a programme: drill titles with deep links.
 *
 * @param program - Programme to announce.
 * @param appUrl - Public base URL without trailing slash.
 * @param dayLabel - Human label for the date, e.g. `"vanavond"` or `"woensdag"`.
 */
export function buildProgramMessage(
  program: TrainingProgram,
  appUrl: string,
  dayLabel: string,
): string {
  const lines: string[] = [];
  for (const item of program.items) {
    if (!item.drill) continue;
    const mins = item.minutes ? ` (${item.minutes} min)` : "";
    lines.push(
      `• ${item.drill.title}${mins} – ${appUrl}/speelboek/${item.drillId}`,
    );
  }
  return [
    `Training ${dayLabel}: dit gaan we oefenen`,
    ...lines,
    "",
    `Bekijk alles in het speelboek: ${appUrl}/speelboek`,
  ].join("\n");
}

/**
 * Sends the programme for a date to the team WhatsApp group.
 *
 * @param date - `YYYY-MM-DD`.
 * @param dayLabel - Human label for the date in the message.
 */
export async function shareProgram(
  date: string,
  dayLabel: string,
): Promise<NotificationResult> {
  const program = await getProgram(date);
  if (program.items.length === 0) {
    return { sent: false, reason: "request_failed", details: "empty_program" };
  }
  const appUrl = getWaapiAppUrl();
  if (!appUrl) return { sent: false, reason: "missing_config" };
  return sendWhatsAppGroupMessage(
    buildProgramMessage(program, appUrl, dayLabel),
  );
}
