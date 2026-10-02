import { describe, expect, it, vi } from "vitest";
import {
  Box3,
  Mesh,
  MeshLambertMaterial,
  Vector3,
  type BufferAttribute,
  type Object3D,
} from "three";
import { LANDMARK_STYLES } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { disposeObject } from "./disposal";
import { landmarkDressing } from "./landmarkDressing";

/**
 * An L-shaped footprint far from the origin. Its centroid is about (1024.3, 2012.4), so the corner
 * farthest from it is (1000, 2000), 27.3 m away.
 */
const CHURCH: Point[] = [
  [1000, 2000],
  [1040, 2000],
  [1040, 2030],
  [1020, 2030],
  [1020, 2012],
  [1000, 2012],
];
const EAVES_M = 9;

/** The meshes under an object. */
function meshesOf(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh) meshes.push(node);
  });
  return meshes;
}

/** The world-space box of an object. */
function worldBox(root: Object3D): Box3 {
  root.updateMatrixWorld(true);
  return new Box3().setFromObject(root);
}

describe("landmarkDressing", () => {
  it.each(LANDMARK_STYLES)(
    "dresses a %s with finite meshes of its own",
    (style) => {
      const dressing = landmarkDressing(style, CHURCH, EAVES_M);

      const meshes = meshesOf(dressing);
      expect(meshes.length).toBeGreaterThan(0);
      for (const mesh of meshes) {
        const position = mesh.geometry.getAttribute(
          "position",
        ) as BufferAttribute;
        expect(position.count).toBeGreaterThan(0);
        expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
      }
      const box = worldBox(dressing);
      expect(box.min.x).toBeGreaterThan(990);
      expect(box.max.z).toBeLessThan(2045);
      expect(box.max.y).toBeGreaterThan(0);
    },
  );

  it("stands a church tower with a spire in the corner farthest from the centroid", () => {
    const dressing = landmarkDressing("church", CHURCH, EAVES_M);

    const box = worldBox(dressing);
    expect(box.max.y).toBeGreaterThan(EAVES_M + 20);
    const tallest = meshesOf(dressing).reduce((best, mesh) =>
      worldBox(mesh).max.y > worldBox(best).max.y ? mesh : best,
    );
    const top = worldBox(tallest).getCenter(new Vector3());
    const toFarCorner = Math.hypot(top.x - 1000, top.z - 2000);
    expect(toFarCorner).toBeLessThan(8);
  });

  it("roofs the pool in see-through glass", () => {
    const dressing = landmarkDressing("pool", CHURCH, EAVES_M);

    const glass = meshesOf(dressing).map(
      (mesh) => mesh.material as MeshLambertMaterial,
    );
    expect(
      glass.some((material) => material.transparent && material.opacity < 1),
    ).toBe(true);
  });

  it("hangs the café's awning outside its longest wall", () => {
    const dressing = landmarkDressing("cafe", CHURCH, EAVES_M);

    const box = worldBox(dressing);
    // The longest wall runs along y = 2000 (40 m); the awning sticks out north of it.
    expect(box.min.z).toBeLessThan(2000);
    expect(box.max.z).toBeLessThanOrEqual(2000 + 1e-6);
    expect(box.max.y).toBeLessThanOrEqual(EAVES_M);
  });

  it("raises the brewery chimney well above the roof", () => {
    const dressing = landmarkDressing("brewery", CHURCH, EAVES_M);

    expect(worldBox(dressing).max.y).toBeGreaterThan(EAVES_M + 10);
  });

  it("frees its own geometry and materials with disposeObject", () => {
    const dressing = landmarkDressing("campus", CHURCH, EAVES_M);
    const meshes = meshesOf(dressing);
    const geometries = meshes.map((mesh) => vi.spyOn(mesh.geometry, "dispose"));

    disposeObject(dressing);

    for (const spy of geometries) expect(spy).toHaveBeenCalledTimes(1);
  });
});
