import type { Drill, DrillCategory } from "../schemas/speelboek";
import { DRILLS } from "../speelboek/drills";
import { CATEGORY_LABELS } from "../speelboek/lineup";

/** Days after `addedOn` during which a drill carries the "Nieuw" badge. */
export const NEW_DRILL_WINDOW_DAYS = 30;

/** Filters accepted by {@link listDrills}. */
export type DrillFilter = {
  category?: DrillCategory;
  /** Case-insensitive match on title, summary, category label or roster position names. */
  query?: string;
};

/**
 * Lists drills, optionally filtered, newest first within the library order.
 *
 * @param filter - Category and/or free-text query; both optional.
 * @returns Matching drills in library order.
 */
export function listDrills(filter: DrillFilter = {}): Drill[] {
  const q = filter.query?.trim().toLocaleLowerCase("nl-NL");
  return DRILLS.filter((d) => {
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
 * Looks up a drill by slug.
 *
 * @param id - Drill slug, e.g. `"tip-in"`.
 * @returns The drill, or `null` when unknown.
 */
export function getDrill(id: string): Drill | null {
  return DRILLS.find((d) => d.id === id) ?? null;
}

/**
 * Returns the drill that shows the same situation from the other side, if any.
 *
 * @param drill - Drill whose counterpart to resolve.
 * @returns The counterpart, or `null` when the drill has none or it is unknown.
 */
export function getCounterpart(drill: Drill): Drill | null {
  return drill.counterpartId ? getDrill(drill.counterpartId) : null;
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
 * @returns Mapping from player id to cap label.
 */
export function rosterLabels(drill: Drill): Record<string, string> {
  return Object.fromEntries(drill.roster.map((r) => [r.playerId, r.label]));
}

/**
 * Groups drills by category in the fixed library order (Aanval, Verdediging, Techniek, Keeper),
 * omitting empty categories.
 *
 * @param drills - Drills to group (typically the result of {@link listDrills}).
 * @returns Non-empty groups in display order.
 */
export function groupByCategory(
  drills: Drill[],
): { category: DrillCategory; drills: Drill[] }[] {
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
