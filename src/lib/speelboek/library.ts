import type { Drill, DrillCategory } from "../schemas/speelboek";
import { CATEGORY_LABELS } from "./lineup";

/**
 * A drill as served to the app: static library content or a trainer-made drill,
 * with its publication state (static drills are always published).
 */
export type LibraryDrill = Drill & {
  source: "static" | "trainer";
  published: boolean;
};

/** Days after `addedOn` during which a drill carries the "Nieuw" badge. */
export const NEW_DRILL_WINDOW_DAYS = 30;

/** Filters accepted by {@link filterDrills}. */
export type DrillFilter = {
  category?: DrillCategory;
  /** Case-insensitive match on title, summary, category label or roster position names. */
  query?: string;
};

/**
 * Filters drills on category and/or free text, keeping their order.
 *
 * @param drills - Drills to filter.
 * @param filter - Category and/or free-text query; both optional.
 */
export function filterDrills<T extends Drill>(
  drills: readonly T[],
  filter: DrillFilter = {},
): T[] {
  const q = filter.query?.trim().toLocaleLowerCase("nl-NL");
  return drills.filter((d) => {
    if (filter.category && d.category !== filter.category) return false;
    if (!q) return true;
    const haystack = [
      d.title,
      d.summary,
      CATEGORY_LABELS[d.category],
      ...d.roster.map((r) => r.name),
    ]
      .join(" ")
      .toLocaleLowerCase("nl-NL");
    return haystack.includes(q);
  });
}

/**
 * Whether a drill was added recently enough to show the "Nieuw" badge.
 *
 * @param drill - Drill to check.
 * @param now - Reference time (defaults to the current time).
 * @returns `true` when `addedOn` lies within {@link NEW_DRILL_WINDOW_DAYS} before `now`.
 */
export function isRecentlyAdded(drill: Drill, now: Date = new Date()): boolean {
  const added = new Date(`${drill.addedOn}T12:00:00Z`).getTime();
  const ageMs = now.getTime() - added;
  return ageMs >= 0 && ageMs <= NEW_DRILL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Cap labels per player id, as expected by `PoolDiagram`.
 *
 * @param drill - Drill whose roster to map.
 */
export function rosterLabels(drill: Drill): Record<string, string> {
  return Object.fromEntries(drill.roster.map((r) => [r.playerId, r.label]));
}

/**
 * Groups drills by category in the fixed library order (Aanval, Verdediging, Techniek, Keeper),
 * omitting empty categories.
 *
 * @param drills - Drills to group.
 */
export function groupByCategory<T extends Drill>(
  drills: T[],
): { category: DrillCategory; drills: T[] }[] {
  const order: DrillCategory[] = [
    "AANVAL",
    "VERDEDIGING",
    "TECHNIEK",
    "KEEPER",
  ];
  return order
    .map((category) => ({
      category,
      drills: drills.filter((d) => d.category === category),
    }))
    .filter((g) => g.drills.length > 0);
}
