/**
 * How much detail the streamed city is built with. "laag" keeps the plain city every phone can
 * draw; "auto" and "hoog" add the façade, street, clutter, tree and lamplight detail. A cell is
 * rebuilt when the level changes, like any other change to what it is built from.
 */
import type { ArenaSettings } from "../schemas";

/** `basic`: the city as it was first built; `full`: with every detail layer. */
export type CityDetail = "basic" | "full";

/**
 * The detail level a render quality builds the city at.
 *
 * @param quality - The settings' render quality.
 * @returns `basic` at "laag", `full` at "auto" and "hoog".
 */
export function cityDetailFor(quality: ArenaSettings["quality"]): CityDetail {
  return quality === "low" ? "basic" : "full";
}
