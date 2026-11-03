import { describe, expect, it } from "vitest";
import { DRILLS } from "./drills";
import {
  filterDrills,
  groupByCategory,
  isRecentlyAdded,
  rosterLabels,
} from "./library";

describe("speelboek library helpers", () => {
  it("filters by category and case-insensitive query", () => {
    expect(filterDrills(DRILLS)).toHaveLength(DRILLS.length);
    const def = filterDrills(DRILLS, { category: "VERDEDIGING" });
    expect(def.length).toBeGreaterThan(0);
    expect(def.every((d) => d.category === "VERDEDIGING")).toBe(true);
    expect(filterDrills(DRILLS, { query: "TIP" }).map((d) => d.id)).toEqual([
      "tip-in",
    ]);
    expect(
      filterDrills(DRILLS, { query: "paal rechts" }).map((d) => d.id),
    ).toContain("4-2-man-meer");
    expect(filterDrills(DRILLS, { query: "   " })).toHaveLength(DRILLS.length);
    expect(filterDrills(DRILLS, { query: "onbestaand" })).toEqual([]);
  });

  it("marks a drill as new for 30 days after addedOn", () => {
    const drill = { ...DRILLS[0], addedOn: "2026-11-03" };
    expect(isRecentlyAdded(drill, new Date("2026-11-03T12:00:00Z"))).toBe(true);
    expect(isRecentlyAdded(drill, new Date("2026-12-03T11:00:00Z"))).toBe(true);
    expect(isRecentlyAdded(drill, new Date("2026-12-04T12:00:00Z"))).toBe(
      false,
    );
    expect(isRecentlyAdded(drill, new Date("2026-10-01T12:00:00Z"))).toBe(
      false,
    );
  });

  it("groups drills in library order and skips empty categories", () => {
    expect(groupByCategory([...DRILLS]).map((g) => g.category)).toEqual([
      "AANVAL",
      "VERDEDIGING",
      "TECHNIEK",
    ]);
    expect(groupByCategory([])).toEqual([]);
  });

  it("maps roster labels by player id", () => {
    expect(rosterLabels(DRILLS.find((d) => d.id === "tip-in")!)).toEqual({
      p1: "1",
      p5: "5",
      p6: "6",
    });
  });
});
