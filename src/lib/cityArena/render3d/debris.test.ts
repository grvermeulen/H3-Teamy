import { describe, expect, it, vi } from "vitest";
import { Matrix4, Quaternion, Vector3, type Material } from "three";
import { createDebrisPool, DEBRIS_GRAVITY, type DebrisSpawn } from "./debris";

/** A chunk thrown straight up from two metres. */
const CHUNK: DebrisSpawn = {
  x: 0,
  y: 2,
  z: 0,
  vx: 0,
  vy: 5,
  vz: 0,
  size: 0.4,
  colour: 0x555555,
  spin: 3,
  maxLife: 2,
};

function placement(
  pool: ReturnType<typeof createDebrisPool>,
  index: number,
): { position: Vector3; scale: Vector3 } {
  const matrix = new Matrix4();
  pool.object.getMatrixAt(index, matrix);
  const position = new Vector3();
  const scale = new Vector3();
  matrix.decompose(position, new Quaternion(), scale);
  return { position, scale };
}

describe("createDebrisPool", () => {
  it("falls under 9.8 m/s² of gravity", () => {
    expect(DEBRIS_GRAVITY).toBe(9.8);
    const pool = createDebrisPool(4);
    pool.spawn(CHUNK);

    pool.update(0.1);

    // Semi-implicit Euler: the speed drops first, then the chunk moves.
    const expected = 2 + (5 - DEBRIS_GRAVITY * 0.1) * 0.1;
    expect(placement(pool, 0).position.y).toBeCloseTo(expected, 5);
  });

  it("draws exactly the living chunks and expires them after maxLife", () => {
    const pool = createDebrisPool(4);
    pool.spawn(CHUNK);
    pool.spawn({ ...CHUNK, maxLife: 0.5 });

    pool.update(0.1);
    expect(pool.object.count).toBe(2);

    pool.update(0.5);
    expect(pool.alive()).toBe(1);
    expect(pool.object.count).toBe(1);
  });

  it("reuses freed slots and drops chunks beyond its capacity", () => {
    const pool = createDebrisPool(3);
    for (let index = 0; index < 5; index++) pool.spawn(CHUNK);
    expect(pool.alive()).toBe(3);

    pool.update(2.1);
    expect(pool.alive()).toBe(0);
    pool.spawn(CHUNK);
    expect(pool.alive()).toBe(1);
  });

  it("comes to rest on the ground instead of falling through it", () => {
    const pool = createDebrisPool(1);
    pool.spawn({ ...CHUNK, maxLife: 10 });

    for (let frame = 0; frame < 300; frame++) pool.update(1 / 60);

    const { position } = placement(pool, 0);
    expect(position.y).toBeGreaterThanOrEqual(0);
    expect(position.y).toBeLessThan(CHUNK.size);
  });

  it("shrinks away over the end of its life instead of popping out", () => {
    const pool = createDebrisPool(1);
    pool.spawn({ ...CHUNK, maxLife: 2 });

    pool.update(1);
    const whole = placement(pool, 0).scale.x;
    pool.update(0.9);
    const fading = placement(pool, 0).scale.x;

    expect(whole).toBeCloseTo(CHUNK.size);
    expect(fading).toBeLessThan(whole);
  });

  it("frees its geometry, material and instance buffers", () => {
    const pool = createDebrisPool(1);
    const geometry = vi.spyOn(pool.object.geometry, "dispose");
    const material = vi.spyOn(pool.object.material as Material, "dispose");
    const instances = vi.spyOn(pool.object, "dispose");

    pool.dispose();

    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    expect(instances).toHaveBeenCalledOnce();
  });
});
