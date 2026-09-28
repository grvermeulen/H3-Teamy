import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createMuzzleMap } from "./muzzleMap";

describe("createMuzzleMap", () => {
  it("keeps each owner's muzzle as a copy, the last write of a frame winning", () => {
    const muzzles = createMuzzleMap();
    const point = new Vector3(1, 2, 3);
    muzzles.begin();
    muzzles.set(7, point);
    point.set(9, 9, 9);
    muzzles.set(30, new Vector3(4, 5, 6));
    muzzles.set(30, new Vector3(4, 5, 7));
    muzzles.end();
    expect(muzzles.points.get(7)!.toArray()).toEqual([1, 2, 3]);
    expect(muzzles.points.get(30)!.toArray()).toEqual([4, 5, 7]);
  });

  it("forgets owners not written in a frame and reuses their vectors", () => {
    const muzzles = createMuzzleMap();
    muzzles.begin();
    muzzles.set(7, new Vector3(1, 1, 1));
    muzzles.set(8, new Vector3(2, 2, 2));
    muzzles.end();
    const gone = muzzles.points.get(8);
    muzzles.begin();
    muzzles.set(7, new Vector3(1, 1, 1));
    muzzles.end();
    expect([...muzzles.points.keys()]).toEqual([7]);
    muzzles.begin();
    muzzles.set(7, new Vector3(1, 1, 1));
    muzzles.set(40, new Vector3(3, 3, 3));
    muzzles.end();
    expect(muzzles.points.get(40)).toBe(gone);
  });

  it("keeps an owner's vector from frame to frame", () => {
    const muzzles = createMuzzleMap();
    muzzles.begin();
    muzzles.set(7, new Vector3(1, 1, 1));
    muzzles.end();
    const first = muzzles.points.get(7);
    muzzles.begin();
    muzzles.set(7, new Vector3(2, 2, 2));
    muzzles.end();
    expect(muzzles.points.get(7)).toBe(first);
    expect(first!.x).toBe(2);
  });
});
