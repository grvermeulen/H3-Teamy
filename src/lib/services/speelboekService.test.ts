import { describe, expect, it } from "vitest";
import { DRILLS } from "../speelboek/drills";
import {
  getCounterpart,
  getDrill,
  groupByCategory,
  isRecentlyAdded,
  listDrills,
  rosterLabels,
} from "./speelboekService";

describe("speelboekService", () => {
  it("lists every drill without filters", () => {
    expect(listDrills()).toHaveLength(DRILLS.length);
  });

  it("filters by category", () => {
    const result = listDrills({ category: "VERDEDIGING" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((d) => d.category === "VERDEDIGING")).toBe(true);
  });

  it("matches a case-insensitive query on title, summary and position names", () => {
    expect(listDrills({ query: "TIP" }).map((d) => d.id)).toEqual(["tip-in"]);
    expect(listDrills({ query: "paal rechts" }).map((d) => d.id)).toContain(
      "4-2-man-meer",
    );
    expect(listDrills({ query: "   " })).toHaveLength(DRILLS.length);
    expect(listDrills({ query: "onbestaand" })).toEqual([]);
  });

  it("looks up drills and counterparts", () => {
    const manMeer = getDrill("4-2-man-meer");
    expect(manMeer?.title).toBe("4-2 man-meer");
    expect(getCounterpart(manMeer!)?.id).toBe("zone-5-tegen-6");
    expect(getCounterpart(getDrill("tip-in")!)).toBeNull();
    expect(getDrill("nope")).toBeNull();
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
    const groups = groupByCategory(listDrills());
    expect(groups.map((g) => g.category)).toEqual([
      "AANVAL",
      "VERDEDIGING",
      "TECHNIEK",
    ]);
    expect(groupByCategory([])).toEqual([]);
  });

  it("maps roster labels by player id", () => {
    expect(rosterLabels(getDrill("tip-in")!)).toEqual({
      p1: "1",
      p5: "5",
      p6: "6",
    });
  });
});
