import * as Sentry from "@sentry/nextjs";
import type { Drill } from "../schemas/speelboek";
import { DRILLS } from "../speelboek/drills";
import type { LibraryDrill } from "../speelboek/library";
import {
  getStoredDrill,
  listStoredDrills,
  type StoredDrill,
} from "./speelboekStore";

export type { LibraryDrill } from "../speelboek/library";

function fromStatic(drill: Drill): LibraryDrill {
  return { ...drill, source: "static", published: true };
}

function fromStored(drill: StoredDrill): LibraryDrill {
  const { createdById: _createdById, updatedAt: _updatedAt, ...rest } = drill;
  return { ...rest, source: "trainer" };
}

/**
 * All drills: the static library plus trainer drills (published only unless
 * `includeDrafts`). A database failure degrades to the static library (reported to Sentry).
 *
 * @param includeDrafts - Also include unpublished trainer drills (trainer views).
 */
export async function getAllDrills(
  includeDrafts = false,
): Promise<LibraryDrill[]> {
  try {
    const stored = await listStoredDrills(includeDrafts);
    return [...stored.map(fromStored), ...DRILLS.map(fromStatic)];
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { component: "speelboek" } });
    return DRILLS.map(fromStatic);
  }
}

/**
 * Looks up a drill by slug in the static library first, then in stored drills.
 * Unpublished trainer drills are returned too: they are unlisted, not secret.
 *
 * @param id - Drill slug, e.g. `"tip-in"`.
 * @returns The drill, or `null` when unknown.
 */
export async function findDrill(id: string): Promise<LibraryDrill | null> {
  const staticDrill = DRILLS.find((d) => d.id === id);
  if (staticDrill) return fromStatic(staticDrill);
  try {
    const stored = await getStoredDrill(id);
    return stored ? fromStored(stored) : null;
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { component: "speelboek" } });
    return null;
  }
}

/** Whether a slug belongs to the static (repo) library rather than a stored drill. */
export function isStaticDrill(id: string): boolean {
  return DRILLS.some((d) => d.id === id);
}

/**
 * Returns the drill that shows the same situation from the other side, if any.
 *
 * @param drill - Drill whose counterpart to resolve.
 */
export async function getCounterpart(
  drill: Drill,
): Promise<LibraryDrill | null> {
  return drill.counterpartId ? findDrill(drill.counterpartId) : null;
}
