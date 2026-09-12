import { describe, expect, it } from "vitest";
import {
  LANDMARK_ART_OVERHANG_M,
  orientedBox,
  paintLandmarkArt,
} from "./drawLandmarks";
import type { PropSprite } from "./sprites";
import { createFakeContext } from "./testing/fakeContext";

/** A 4 × 15 m house running north–south, like Cuneralaan 42. */
const house: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 15],
  [0, 15],
];

describe("orientedBox", () => {
  it("measures a north–south house along its long side and points its length south", () => {
    const box = orientedBox(house);
    expect(box.length).toBeCloseTo(15, 9);
    expect(box.width).toBeCloseTo(4, 9);
    expect(box.centre[0]).toBeCloseTo(2, 9);
    expect(box.centre[1]).toBeCloseTo(7.5, 9);
    expect(Math.cos(box.angle)).toBeCloseTo(0, 9);
    expect(Math.sin(box.angle)).toBeCloseTo(1, 9);
  });

  it("points an east–west house's length east whichever way its ring winds", () => {
    const eastWest = house.map(([x, y]): [number, number] => [y, x]);
    for (const ring of [eastWest, [...eastWest].reverse()]) {
      const box = orientedBox(ring);
      expect(box.length).toBeCloseTo(15, 9);
      expect(Math.cos(box.angle)).toBeCloseTo(1, 9);
    }
  });

  it("follows a tilted footprint's longest edge", () => {
    const tilted = house.map(([x, y]): [number, number] => [
      x * Math.SQRT1_2 - y * Math.SQRT1_2,
      x * Math.SQRT1_2 + y * Math.SQRT1_2,
    ]);
    const box = orientedBox(tilted);
    expect(box.length).toBeCloseTo(15, 6);
    expect(box.width).toBeCloseTo(4, 6);
  });
});

describe("paintLandmarkArt", () => {
  it("draws the art over the footprint's length plus the overhang, as wide as its own aspect", () => {
    const sprite: PropSprite = {
      image: {} as CanvasImageSource,
      lengthMetres: 16,
      widthMetres: 8,
    };
    const context = createFakeContext();
    paintLandmarkArt(context, { ring: house }, sprite);
    const length = 15 + 2 * LANDMARK_ART_OVERHANG_M;
    expect(context.calls).toContain(
      `drawImage([object Object],${-length / 2},${-length / 4},${length},${length / 2})`,
    );
    expect(context.calls.some((call) => call.startsWith("rotate("))).toBe(true);
  });
});
