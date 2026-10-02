import { describe, expect, it } from "vitest";
import { createArenaNavigation, planNavigation } from "./navigation";
import { decodeRoadGraph } from "./roadGraph";

const square = decodeRoadGraph({
  nodes: [0, 0, 400, 0, 400, 400, 0, 400],
  edges: [
    0, 1, 0, -1, 1, 400, 1, 2, 0, -1, 0, 400, 2, 3, 0, -1, 0, 400, 3, 0, 0, -1,
    0, 400,
  ],
  classes: ["residential"],
  names: [],
});

describe("street navigation", () => {
  it("snaps to the middle of a long street without detouring through its endpoints", () => {
    const before = JSON.stringify(square);
    const result = planNavigation(square, [20, -2], [80, -3], true);
    expect(result.points).toEqual([
      [20, 0],
      [80, 0],
    ]);
    expect(result.destination).toEqual([80, 0]);
    expect(result.distanceM).toBe(62);
    expect(JSON.stringify(square)).toBe(before);
  });

  it("routes around the block against a one-way street, but allows walking back", () => {
    const driving = planNavigation(square, [80, 0], [20, 0], true);
    expect(driving.points).toEqual([
      [80, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
      [20, 0],
    ]);
    expect(driving.distanceM).toBe(340);
    expect(planNavigation(square, [80, 0], [20, 0], false).distanceM).toBe(60);
  });

  it("allows turning at a junction that is also a one-way endpoint", () => {
    const junction = decodeRoadGraph({
      nodes: [0, 0, 400, 0, 0, 400],
      edges: [0, 2, 0, -1, 0, 400, 0, 1, 0, -1, 1, 400],
      classes: ["residential"],
      names: [],
    });
    expect(planNavigation(junction, [0, 0], [0, 80], true).distanceM).toBe(80);
    expect(planNavigation(junction, [0, 80], [0, 0], true).distanceM).toBe(80);
  });

  it("does not invent a straight route between disconnected streets or distant off-map points", () => {
    const disconnected = decodeRoadGraph({
      nodes: [0, 0, 400, 0, 1600, 0, 2000, 0],
      edges: [0, 1, 0, -1, 0, 400, 2, 3, 0, -1, 0, 400],
      classes: ["residential"],
      names: [],
    });
    expect(
      planNavigation(disconnected, [20, 0], [450, 0], false),
    ).toMatchObject({ status: "unreachable", points: [] });
    expect(planNavigation(square, [0, 0], [1000, 1000], false).status).toBe(
      "unreachable",
    );
  });

  it("keeps vehicles off pedestrian streets", () => {
    const walking = decodeRoadGraph({
      nodes: [0, 0, 400, 0],
      edges: [0, 1, 0, -1, 0, 400],
      classes: ["pedestrian"],
      names: [],
    });
    expect(planNavigation(walking, [10, 0], [90, 0], true).status).toBe(
      "unreachable",
    );
    expect(planNavigation(walking, [10, 0], [90, 0], false).distanceM).toBe(80);
  });

  it("reroutes as the player moves and changes mode, then clears the destination", () => {
    const navigation = createArenaNavigation(square);
    navigation.select([20, 0], [80, 0], true);
    expect(navigation.snapshot()?.distanceM).toBe(340);
    expect(navigation.update([90, 0], true, 1000)?.distanceM).toBe(330);
    const previous = navigation.snapshot();
    expect(navigation.update([100, 5], true, 1100)).toBe(previous);
    expect(navigation.update([80, 0], false, 1200)?.distanceM).toBe(60);
    navigation.select(null, [80, 0], false);
    expect(navigation.update([0, 0], false, 3000)).toBeNull();
  });

  it("recognizes arrival within the movement threshold and keeps guidance stopped", () => {
    const navigation = createArenaNavigation(square);
    navigation.select([80, 0], [67, 0], true);
    expect(navigation.snapshot()?.status).toBe("navigating");
    expect(navigation.update([69, 0], true, 100)?.status).toBe("arrived");
    expect(navigation.update([90, 0], true, 2000)?.status).toBe("arrived");
  });
});
