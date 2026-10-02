import { describe, expect, it, vi } from "vitest";
import { createDebrisPool } from "./debris";
import { emitChunk, emitPuff, rngFor, within, type PuffSpec } from "./fxEmit";
import { createParticleSystem, type Particle } from "./particles";

const SPEC: PuffSpec = {
  scatter: 0.5,
  lift: [1, 2],
  outward: [3, 4],
  spread: 0.1,
  rise: [5, 6],
  life: [0.5, 0.6],
  size: [0.2, 0.3],
  colours: [0x112233, 0x445566],
  gravity: 9.8,
  drag: 1,
};

function capture(heading?: number, seed = 1): Omit<Particle, "life"> {
  const system = createParticleSystem(4, true);
  const spawn = vi.spyOn(system, "spawn");
  emitPuff(system, rngFor("test", seed), SPEC, { x: 10, y: 0, z: 20 }, heading);
  return { ...spawn.mock.calls[0][0] };
}

describe("fxEmit", () => {
  it("draws every value from its spec's ranges", () => {
    const puff = capture();

    expect(Math.hypot(puff.x - 10, puff.z - 20)).toBeLessThanOrEqual(0.5);
    expect(puff.y).toBeGreaterThanOrEqual(1);
    expect(puff.y).toBeLessThan(2);
    const outward = Math.hypot(puff.vx, puff.vz);
    expect(outward).toBeGreaterThanOrEqual(3);
    expect(outward).toBeLessThan(4);
    expect(puff.vy).toBeGreaterThanOrEqual(5);
    expect(puff.maxLife).toBeGreaterThanOrEqual(0.5);
    expect(SPEC.colours).toContain(puff.colour);
    expect([puff.gravity, puff.drag]).toEqual([9.8, 1]);
  });

  it("throws along a world heading, within the spec's spread", () => {
    const heading = Math.PI / 2;

    const puff = capture(heading);

    const angle = Math.atan2(puff.vz, puff.vx);
    expect(Math.abs(angle - heading)).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it("repeats a burst exactly for the same seed and varies it for another", () => {
    expect(capture(undefined, 3)).toEqual(capture(undefined, 3));
    expect(capture(undefined, 3)).not.toEqual(capture(undefined, 4));
    expect(within(rngFor("a", 1), [2, 2])).toBe(2);
  });

  it("throws debris chunks into the chunk pool", () => {
    const pool = createDebrisPool(2);

    emitChunk(
      pool,
      rngFor("chunk", 1),
      { ...SPEC, spin: [1, 2] },
      {
        x: 0,
        y: 1,
        z: 0,
      },
    );

    expect(pool.alive()).toBe(1);
  });
});
