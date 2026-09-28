import { describe, expect, it } from "vitest";
import {
  SWATCH,
  linearOf,
  sampleSwatch,
  swatchAt,
  swatchCentre,
} from "./carAtlas";
import { fixtureAtlas, fixtureCar, fixtureSwatchColour } from "./carFixture";
import {
  PLATE_RECESS,
  boundsOf,
  boxSoup,
  centroidOf,
  normalOf,
  recentring,
  splitBody,
  toCarFrame,
  triangleCount,
  type BodyRules,
} from "./carGeometry";

const RULES: BodyRules = {
  paint: [SWATCH.redPaint],
  recolour: { [SWATCH.glass]: 0x2a3a4c },
  lightBar: true,
};

/** The fixture car's body in the game's frame, recentred as the pack does. */
function gameBody(): ReturnType<typeof toCarFrame> {
  const body = toCarFrame(fixtureCar().body);
  const shift = recentring(boundsOf(body.positions));
  for (let index = 0; index < body.positions.length; index += 1)
    body.positions[index] += shift[index % 3];
  return body;
}

describe("carAtlas", () => {
  it("finds the swatch a UV falls in, clamped to the atlas", () => {
    expect(swatchAt(0.83, 0.3)).toBe("13:1");
    expect(swatchAt(1.2, -0.1)).toBe("15:0");
    expect(swatchAt(...swatchCentre(SWATCH.glass))).toBe(SWATCH.glass);
  });

  it("reads a vertex on a swatch's edge from its own swatch", () => {
    const atlas = fixtureAtlas();
    const [column, row] = [7, 2];
    const onEdge = sampleSwatch(atlas, "7:2", 8 / 16, 3 / 4);
    expect(onEdge).toBe(fixtureSwatchColour(column, row));
  });

  it("decodes sRGB to linear", () => {
    expect(linearOf(0xffffff)).toEqual([1, 1, 1]);
    expect(linearOf(0x808080)[0]).toBeCloseTo(0.216, 3);
  });
});

describe("carGeometry", () => {
  it("turns the Kit's frame into the game's: forward becomes +x, left becomes −z", () => {
    const turned = toCarFrame({ positions: [1, 2, 3], uvs: [] });
    expect(turned.positions).toEqual([3, 2, -1]);
  });

  it("builds boxes whose faces point out", () => {
    const soup = boxSoup([0, 0, 0], [2, 2, 2], SWATCH.dark);
    expect(triangleCount(soup.positions)).toBe(12);
    for (let triangle = 0; triangle < 12; triangle += 1) {
      const centre = centroidOf(soup.positions, triangle);
      const normal = normalOf(soup.positions, triangle);
      const outward = centre.reduce(
        (sum, value, axis) => sum + value * normal[axis],
        0,
      );
      expect(outward).toBeGreaterThan(0);
    }
  });

  it("recentres a model on its footprint centre with its lowest point on the ground", () => {
    expect(recentring({ min: [-1, 0.5, -2], max: [3, 2, 0] })).toEqual([
      -1, -0.5, 1,
    ]);
  });
});

describe("splitBody", () => {
  const atlas = fixtureAtlas();
  const body = gameBody();
  const split = splitBody(body, RULES, boundsOf(body.positions), atlas);

  it("sorts lamps, lenses, the plate and the paint into their roles", () => {
    expect(triangleCount(split.roles.head.positions)).toBe(24);
    expect(triangleCount(split.roles.tail.positions)).toBe(24);
    expect(triangleCount(split.roles["lens-left"].positions)).toBe(12);
    expect(triangleCount(split.roles["lens-right"].positions)).toBe(12);
    expect(triangleCount(split.roles.paint.positions)).toBe(12);
    expect(triangleCount(split.plates.front.positions)).toBe(2);
    expect(split.plates.rear.positions).toHaveLength(0);
  });

  it("splits the roof lamps into the left and the right lens", () => {
    expect(boundsOf(split.roles["lens-left"].positions).max[2]).toBeLessThan(0);
    expect(
      boundsOf(split.roles["lens-right"].positions).min[2],
    ).toBeGreaterThan(0);
  });

  it("recesses the plate in the trim colour", () => {
    const recess = linearOf(PLATE_RECESS);
    const plate = split.plates.front.colours;
    for (let index = 0; index < plate.length; index += 1)
      expect(plate[index]).toBeCloseTo(recess[index % 3], 6);
  });

  it("stores the paint as a grey shade of its swatch's gradient", () => {
    const [u] = swatchCentre(SWATCH.redPaint);
    const triangle = {
      positions: [0, 0, 0, 0, 1, 0, 0, 0, 1],
      uvs: [u, 0.26, u, 0.375, u, 0.49],
    };
    const shaded = splitBody(
      triangle,
      RULES,
      boundsOf(triangle.positions),
      atlas,
    );
    const shades = shaded.roles.paint.colours;
    expect(shades).toHaveLength(9);
    for (let index = 0; index < shades.length; index += 3) {
      expect(shades[index]).toBeCloseTo(shades[index + 1], 6);
      expect(shades[index]).toBeCloseTo(shades[index + 2], 6);
    }
    expect(shades[0]).toBeGreaterThan(1);
    expect(shades[6]).toBeLessThan(1);
  });

  it("drops triangles without area", () => {
    const flat = {
      positions: [0, 0, 0, 1, 0, 0, 2, 0, 0],
      uvs: [0.8, 0.3, 0.8, 0.3, 0.8, 0.3],
    };
    const nothing = splitBody(flat, RULES, boundsOf(flat.positions), atlas);
    expect(nothing.roles.paint.positions).toHaveLength(0);
    expect(nothing.roles.detail.positions).toHaveLength(0);
  });
});
