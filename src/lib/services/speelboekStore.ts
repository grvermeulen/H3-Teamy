import * as Sentry from "@sentry/nextjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { slugifyTitle } from "../eventId";
import { drillSchema, type Drill, type DrillInput } from "../schemas/speelboek";
import { DRILLS } from "../speelboek/drills";

/** A drill stored in Postgres (made by a trainer), with its publication state. */
export type StoredDrill = Drill & {
  published: boolean;
  createdById: string | null;
  updatedAt: string;
};

type DrillRow = {
  id: string;
  content: Prisma.JsonValue;
  published: boolean;
  createdById: string | null;
  updatedAt: Date;
};

const ROW_SELECT = {
  id: true,
  content: true,
  published: true,
  createdById: true,
  updatedAt: true,
} as const;

function rowToDrill(row: DrillRow): StoredDrill | null {
  const parsed = drillSchema.safeParse(row.content);
  if (!parsed.success) {
    Sentry.captureMessage("SpeelboekDrill met ongeldige content", {
      level: "warning",
      tags: { component: "speelboek-store" },
      extra: { id: row.id, issues: parsed.error.issues },
    });
    return null;
  }
  return {
    ...parsed.data,
    id: row.id,
    published: row.published,
    createdById: row.createdById,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Lists trainer-made drills, newest first.
 *
 * @param includeDrafts - Also return unpublished drills (trainer view).
 */
export async function listStoredDrills(
  includeDrafts = false,
): Promise<StoredDrill[]> {
  const rows = await prisma.speelboekDrill.findMany({
    where: includeDrafts ? undefined : { published: true },
    select: ROW_SELECT,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(rowToDrill).filter((d): d is StoredDrill => d !== null);
}

/** Looks up one stored drill by id (drafts included). */
export async function getStoredDrill(id: string): Promise<StoredDrill | null> {
  const row = await prisma.speelboekDrill.findUnique({
    where: { id },
    select: ROW_SELECT,
  });
  return row ? rowToDrill(row) : null;
}

/**
 * Picks a slug for a new drill that collides neither with the static drills
 * nor with existing stored drills.
 */
export async function uniqueDrillSlug(title: string): Promise<string> {
  const base = slugifyTitle(title) || "oefening";
  const taken = new Set<string>(DRILLS.map((d) => d.id));
  const rows = await prisma.speelboekDrill.findMany({
    where: { id: { startsWith: base } },
    select: { id: true },
  });
  for (const r of rows) taken.add(r.id);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function toContent(drill: Drill): Prisma.InputJsonValue {
  return drill as unknown as Prisma.InputJsonValue;
}

/**
 * Creates a trainer drill. The slug is derived from the title; `addedOn` is today.
 *
 * @param input - Validated drill body.
 * @param userId - Trainer creating the drill.
 */
export async function createStoredDrill(
  input: DrillInput,
  userId: string,
): Promise<StoredDrill> {
  const { published, ...body } = input;
  const id = await uniqueDrillSlug(body.title);
  const drill: Drill = { ...body, id, addedOn: todayYmd() };
  const row = await prisma.speelboekDrill.create({
    data: {
      id,
      createdById: userId,
      title: drill.title,
      category: drill.category,
      published,
      content: toContent(drill),
    },
    select: { updatedAt: true },
  });
  return {
    ...drill,
    published,
    createdById: userId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Replaces the content of a stored drill, keeping its id and `addedOn`.
 *
 * @returns The updated drill, or `null` when the id is unknown.
 */
export async function updateStoredDrill(
  id: string,
  input: DrillInput,
): Promise<StoredDrill | null> {
  const existing = await getStoredDrill(id);
  if (!existing) return null;
  const { published, ...body } = input;
  const drill: Drill = { ...body, id, addedOn: existing.addedOn };
  const row = await prisma.speelboekDrill.update({
    where: { id },
    data: {
      title: drill.title,
      category: drill.category,
      published,
      content: toContent(drill),
    },
    select: { updatedAt: true },
  });
  return {
    ...drill,
    published,
    createdById: existing.createdById,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Deletes a stored drill together with its acks, questions and programme items. */
export async function deleteStoredDrill(id: string): Promise<boolean> {
  const existing = await prisma.speelboekDrill.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.$transaction([
    prisma.drillAck.deleteMany({ where: { drillId: id } }),
    prisma.drillQuestion.deleteMany({ where: { drillId: id } }),
    prisma.trainingProgramItem.deleteMany({ where: { drillId: id } }),
    prisma.speelboekDrill.delete({ where: { id } }),
  ]);
  return true;
}
