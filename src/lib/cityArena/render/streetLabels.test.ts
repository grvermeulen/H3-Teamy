import { describe, expect, it } from "vitest";
import type { DecodedRoad } from "../world/decode";
import { planStreetLabels } from "./streetLabels";

const own = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 };
function road(points: [number, number][], name = "Dorpsstraat"): DecodedRoad {
  return {
    points,
    roadClass: "residential",
    name,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
}

describe("planStreetLabels", () => {
  it("places one centred label on a short road and none on very short or unnamed roads", () => {
    expect(
      planStreetLabels(
        road([
          [0, 10],
          [100, 10],
        ]),
        own,
      ),
    ).toEqual([{ text: "Dorpsstraat", x: 50, y: 10, angle: 0 }]);
    expect(
      planStreetLabels(
        road([
          [0, 10],
          [30, 10],
        ]),
        own,
      ),
    ).toEqual([]);
    expect(
      planStreetLabels(
        {
          ...road([
            [0, 10],
            [100, 10],
          ]),
          name: undefined,
        },
        own,
      ),
    ).toEqual([]);
  });

  it("repeats labels every 120 m and flips upside-down text", () => {
    const labels = planStreetLabels(
      road([
        [300, 10],
        [0, 10],
      ]),
      own,
    );
    expect(labels.map((label) => label.x)).toEqual([200, 100]);
    expect(labels.every((label) => label.angle === 0)).toBe(true);
    const diagonal = planStreetLabels(
      road([
        [0, 0],
        [100, 100],
      ]),
      own,
    );
    expect(diagonal[0].angle).toBeCloseTo(Math.PI / 4);
  });

  it("skips labels whose anchor lies outside the tile's own rectangle", () => {
    expect(
      planStreetLabels(
        road([
          [1990, 10],
          [2090, 10],
        ]),
        own,
      ),
    ).toEqual([]);
  });
});
