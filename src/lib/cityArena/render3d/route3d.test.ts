import { AdditiveBlending, BufferAttribute, Color } from "three";
import { describe, expect, it, vi } from "vitest";
import { ROUTE_RGB } from "../render/palette";
import type { Point } from "../world/projection";
import { ROAD_Y_M } from "./buildCell";
import type { GlowMaterial } from "./glowMaterial";
import {
  ROUTE_LIFT_M,
  ROUTE_WIDTH_M,
  createRoute3d,
  routeRibbon,
  sameRoute,
} from "./route3d";

const L_ROUTE: Point[] = [
  [0, 0],
  [10, 0],
  [10, 10],
];

/** The ribbon's corners at one route point: the left edge, then the right. */
function cornersAt(
  positions: ArrayLike<number>,
  point: number,
): { left: number[]; right: number[] } {
  const at = point * 6;
  return {
    left: [positions[at], positions[at + 1], positions[at + 2]],
    right: [positions[at + 3], positions[at + 4], positions[at + 5]],
  };
}

describe("sameRoute", () => {
  it("is the same route for the same list, or one of the same length and ends", () => {
    expect(sameRoute(L_ROUTE, L_ROUTE)).toBe(true);
    expect(
      sameRoute(
        L_ROUTE,
        L_ROUTE.map(([x, y]): Point => [x, y]),
      ),
    ).toBe(true);
    expect(sameRoute(undefined, undefined)).toBe(true);
  });

  it("is a new route when the length, the start or the end changes, or one is missing", () => {
    expect(sameRoute(L_ROUTE, L_ROUTE.slice(0, 2))).toBe(false);
    expect(sameRoute(L_ROUTE, [[1, 0], ...L_ROUTE.slice(1)])).toBe(false);
    expect(sameRoute(L_ROUTE, [...L_ROUTE.slice(0, 2), [10, 11]])).toBe(false);
    expect(sameRoute(L_ROUTE, undefined)).toBe(false);
    expect(sameRoute(undefined, L_ROUTE)).toBe(false);
  });
});

describe("routeRibbon", () => {
  it("lays a band of the route's width at its height, centred on the points", () => {
    const ribbon = routeRibbon([
      [0, 0],
      [20, 0],
    ]);

    const start = cornersAt(ribbon.positions, 0);
    expect(start.left[1]).toBeCloseTo(ROAD_Y_M + ROUTE_LIFT_M);
    expect(Math.abs(start.left[2] - start.right[2])).toBeCloseTo(ROUTE_WIDTH_M);
    expect(start.left[0]).toBe(0);
    expect((start.left[2] + start.right[2]) / 2).toBeCloseTo(0);
    expect(ribbon.indices).toHaveLength(6);
  });

  it("keeps its width round a corner, with a mitred join", () => {
    const ribbon = routeRibbon(L_ROUTE);

    const corner = cornersAt(ribbon.positions, 1);
    const across = Math.hypot(
      corner.left[0] - corner.right[0],
      corner.left[2] - corner.right[2],
    );
    expect(across).toBeCloseTo(ROUTE_WIDTH_M * Math.SQRT2);
    expect((corner.left[0] + corner.right[0]) / 2).toBeCloseTo(10);
    expect((corner.left[2] + corner.right[2]) / 2).toBeCloseTo(0);
  });

  it("caps the join of a hairpin so it never spikes out", () => {
    const ribbon = routeRibbon([
      [0, 0],
      [10, 0],
      [0, 0.5],
    ]);

    const corner = cornersAt(ribbon.positions, 1);
    const across = Math.hypot(
      corner.left[0] - corner.right[0],
      corner.left[2] - corner.right[2],
    );
    expect(across).toBeLessThanOrEqual(ROUTE_WIDTH_M * 2 + 1e-5);
  });

  it("runs its u across the band and skips repeated points", () => {
    const ribbon = routeRibbon([
      [0, 0],
      [0, 0],
      [0, 5],
    ]);

    expect(ribbon.positions).toHaveLength(2 * 2 * 3);
    expect(Array.from(ribbon.uvs.slice(0, 4))).toEqual([0, 0, 1, 0]);
    expect(ribbon.uvs[5]).toBeCloseTo(5);
    expect(Number.isNaN(Math.max(...ribbon.positions))).toBe(false);
  });
});

describe("createRoute3d", () => {
  it("glows additively in the 2D route's cyan, soft at its edges and faded by the fog", () => {
    const route = createRoute3d();
    const material = route.object.material as GlowMaterial;
    const [r, g, b] = ROUTE_RGB;
    const cyan = new Color(`rgb(${r},${g},${b})`);

    expect(material.blending).toBe(AdditiveBlending);
    expect(material.fog).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.uniforms.uColour.value.toArray()).toEqual(cyan.toArray());
    expect(material.uniforms.uAcrossFade.value).toBeGreaterThan(0);
  });

  it("is hidden without a route of two points or more", () => {
    const route = createRoute3d();
    route.update(undefined);
    expect(route.object.visible).toBe(false);
    route.update([[0, 0]]);
    expect(route.object.visible).toBe(false);
    route.update(L_ROUTE);
    expect(route.object.visible).toBe(true);
  });

  it("rebuilds only when the route changes, and frees the old band", () => {
    const route = createRoute3d();
    route.update(L_ROUTE);
    const first = route.object.geometry;
    const dispose = vi.spyOn(first, "dispose");

    route.update(L_ROUTE.map(([x, y]): Point => [x, y]));
    expect(route.object.geometry).toBe(first);
    route.update([...L_ROUTE, [20, 10]]);

    expect(route.object.geometry).not.toBe(first);
    expect(dispose).toHaveBeenCalledOnce();
    const position = route.object.geometry.getAttribute(
      "position",
    ) as BufferAttribute;
    expect(position.count).toBe(8);
  });

  it("frees its band and material", () => {
    const route = createRoute3d();
    route.update(L_ROUTE);
    const geometry = vi.spyOn(route.object.geometry, "dispose");
    const material = vi.spyOn(route.object.material as GlowMaterial, "dispose");

    route.dispose();

    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
  });
});
