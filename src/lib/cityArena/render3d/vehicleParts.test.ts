import { Box3, Mesh, Vector3, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { buildVehicleModel } from "./vehicleModels";
import { slab } from "./vehicleParts";

/** Vertices of the bus, oldtimer and tank before their shells were rounded (spec §8). */
const VERTICES_BEFORE_ROUNDING = { bus: 2424, oldtimer: 1940, tank: 1892 };
/** The rounded kinds may take at most this many times as many vertices. */
const VERTEX_GROWTH_LIMIT = 2;

function verticesOf(root: Object3D): number {
  let vertices = 0;
  root.traverse((node) => {
    if (node instanceof Mesh)
      vertices += node.geometry.getAttribute("position").count;
  });
  return vertices;
}

describe("slab", () => {
  const spec = { x: [0, 2], y: [0, 1], width: 1 } as const;

  it("rounds every edge and corner, keeping the box's extent", () => {
    const rounded = slab({ ...spec, round: 0.2 });
    rounded.computeBoundingBox();
    const size = rounded.boundingBox?.getSize(new Vector3());
    expect(size?.toArray()).toEqual(
      [2, 1, 1].map((value) => expect.closeTo(value, 5)),
    );
    const corner = new Vector3(2, 1, 0.5);
    const position = rounded.getAttribute("position");
    let nearest = Infinity;
    for (let index = 0; index < position.count; index += 1)
      nearest = Math.min(
        nearest,
        corner.distanceTo(new Vector3().fromBufferAttribute(position, index)),
      );
    expect(nearest).toBeGreaterThan(0.05);
    expect(rounded.index).not.toBeNull();
  });

  it("never rounds past half the thinnest side", () => {
    const thin = slab({ ...spec, y: [0, 0.1], round: 1 });
    thin.computeBoundingBox();
    const box = thin.boundingBox ?? new Box3();
    expect(box.getSize(new Vector3()).y).toBeCloseTo(0.1, 5);
  });
});

describe("the rounder bus, oldtimer and tank", () => {
  it.each(["bus", "oldtimer", "tank"] as const)(
    "round the %s within twice its old vertex budget",
    (kind) => {
      const before = VERTICES_BEFORE_ROUNDING[kind];
      const vertices = verticesOf(buildVehicleModel(kind, 0).root);
      expect(vertices).toBeGreaterThan(before);
      expect(vertices).toBeLessThanOrEqual(before * VERTEX_GROWTH_LIMIT);
    },
  );
});
