import { describe, expect, it, vi } from "vitest";
import { Mesh, PointLight, type Material } from "three";
import type { FireballMaterial } from "./fireballMaterial";
import {
  createFlashPool,
  EXPLOSION_LIGHT_COLOUR,
  EXPLOSION_LIGHT_INTENSITY,
  EXPLOSION_LIGHT_S,
  FIREBALL_END_RADIUS_M,
  FIREBALL_S,
  FIREBALL_START_RADIUS_M,
  MAX_FLASH_LIGHTS,
  MUZZLE_LIGHT_S,
} from "./flashes";

function lights(pool: ReturnType<typeof createFlashPool>): PointLight[] {
  const found: PointLight[] = [];
  pool.object.traverse((node) => {
    if (node instanceof PointLight) found.push(node);
  });
  return found;
}

/** Lights giving off light; a dark light keeps its place in the scene at intensity 0. */
function litLights(pool: ReturnType<typeof createFlashPool>): PointLight[] {
  return lights(pool).filter((light) => light.intensity > 0);
}

/** Ruling 21: the renderer's light count never changes, so no material recompiles. */
function visibleLightCount(pool: ReturnType<typeof createFlashPool>): number {
  return lights(pool).filter((light) => light.visible).length;
}

function visibleFireballs(pool: ReturnType<typeof createFlashPool>): Mesh[] {
  const found: Mesh[] = [];
  pool.object.traverse((node) => {
    if (node instanceof Mesh && node.name === "fireball" && node.visible)
      found.push(node);
  });
  return found.filter((ball) => ball.parent?.visible);
}

describe("createFlashPool", () => {
  it("keeps exactly four lights in the scene, all at intensity 0 while nothing happens", () => {
    const pool = createFlashPool();

    expect(MAX_FLASH_LIGHTS).toBe(4);
    expect(lights(pool)).toHaveLength(4);
    expect(visibleLightCount(pool)).toBe(MAX_FLASH_LIGHTS);
    expect(pool.litCount()).toBe(0);
    expect(litLights(pool)).toHaveLength(0);
  });

  it("never changes the number of visible lights, before, during or after flashes", () => {
    const pool = createFlashPool();
    const counts = [visibleLightCount(pool)];

    for (let blast = 0; blast < 6; blast++) pool.explode(blast, 1, 0);
    pool.muzzle(50, 1.3, 0);
    counts.push(visibleLightCount(pool));
    pool.update(0.1);
    counts.push(visibleLightCount(pool));
    pool.update(1);
    counts.push(visibleLightCount(pool));

    expect(counts).toEqual([4, 4, 4, 4]);
  });

  it("lights an explosion orange at full intensity where it happens", () => {
    const pool = createFlashPool();

    pool.explode(10, 1, -4);

    const [light] = litLights(pool);
    expect(light.color.getHex()).toBe(EXPLOSION_LIGHT_COLOUR);
    expect(EXPLOSION_LIGHT_COLOUR).toBe(0xffa040);
    expect(light.intensity).toBe(EXPLOSION_LIGHT_INTENSITY);
    expect(EXPLOSION_LIGHT_INTENSITY).toBe(40);
    expect(light.position.x).toBe(10);
    expect(light.position.z).toBe(-4);
  });

  it("dims the flash and releases its light after 0.25 s", () => {
    expect(EXPLOSION_LIGHT_S).toBe(0.25);
    const pool = createFlashPool();
    pool.explode(0, 1, 0);
    pool.update(0.1);
    expect(litLights(pool)[0].intensity).toBe(EXPLOSION_LIGHT_INTENSITY);

    pool.update(0.1);
    const [light] = litLights(pool);
    expect(light.intensity).toBeGreaterThan(0);
    expect(light.intensity).toBeLessThan(EXPLOSION_LIGHT_INTENSITY);

    pool.update(0.15);
    expect(pool.litCount()).toBe(0);
    expect(light.intensity).toBe(0);
    expect(light.visible).toBe(true);
  });

  it("never lights more than four: a fifth blast takes the oldest light", () => {
    const pool = createFlashPool();
    for (let blast = 0; blast < 4; blast++) {
      pool.explode(blast, 1, 0);
      pool.update(0.01);
    }

    pool.explode(99, 1, 0);

    expect(pool.litCount()).toBe(4);
    const xs = litLights(pool).map((light) => light.position.x);
    expect(xs).toContain(99);
    expect(xs).not.toContain(0);
  });

  it("flashes a muzzle for 0.05 s with a spare light", () => {
    expect(MUZZLE_LIGHT_S).toBe(0.05);
    const pool = createFlashPool();

    pool.muzzle(0, 1.3, 0);
    expect(pool.litCount()).toBe(1);
    pool.update(1 / 60);

    pool.update(0.05);
    expect(pool.litCount()).toBe(0);
  });

  it("lights a muzzle flash through the frame it fires in, even when that frame outlasts it", () => {
    const pool = createFlashPool();
    pool.muzzle(0, 1.3, 0);

    pool.update(1 / 18);

    expect(pool.litCount()).toBe(1);
    expect(litLights(pool)).toHaveLength(1);
    pool.update(1 / 18);
    expect(pool.litCount()).toBe(0);
  });

  it("lets muzzle flashes use only spare lights, and blasts take theirs first", () => {
    const pool = createFlashPool();
    for (let blast = 0; blast < 3; blast++) pool.explode(blast, 1, 0);
    pool.muzzle(50, 1.3, 0);
    pool.muzzle(60, 1.3, 0);
    expect(pool.litCount()).toBe(4);

    pool.explode(7, 1, 0);

    const xs = litLights(pool).map((light) => light.position.x);
    expect(xs).toEqual(expect.arrayContaining([0, 1, 2, 7]));
    expect(xs).not.toContain(50);
  });

  it("never takes a light from a burning explosion for a muzzle flash", () => {
    const pool = createFlashPool();
    for (let blast = 0; blast < 4; blast++) pool.explode(blast, 1, 0);

    pool.muzzle(50, 1.3, 0);

    const xs = litLights(pool).map((light) => light.position.x);
    expect(xs.sort()).toEqual([0, 1, 2, 3]);
  });

  it("grows the fireball from 0.5 m to 4 m over 0.35 s, then hides it", () => {
    expect([
      FIREBALL_START_RADIUS_M,
      FIREBALL_END_RADIUS_M,
      FIREBALL_S,
    ]).toEqual([0.5, 4, 0.35]);
    const pool = createFlashPool();
    pool.explode(0, 1, 0);
    const [ball] = visibleFireballs(pool);
    expect(ball.scale.x).toBeCloseTo(FIREBALL_START_RADIUS_M);
    const glow = (ball.material as FireballMaterial).uniforms.uOpacity;
    const fresh = glow.value;

    pool.update(FIREBALL_S * 0.999);
    expect(ball.scale.x).toBeCloseTo(FIREBALL_END_RADIUS_M, 1);
    expect(glow.value).toBeLessThan(fresh);

    pool.update(FIREBALL_S * 0.01);
    expect(visibleFireballs(pool)).toHaveLength(0);
  });

  it("recycles the oldest fireball when every one is burning", () => {
    const pool = createFlashPool();
    for (let blast = 0; blast < 40; blast++) pool.explode(blast, 1, 0);

    const balls = visibleFireballs(pool);
    expect(balls.length).toBeGreaterThan(0);
    expect(balls.length).toBeLessThan(40);
    const xs = balls.map((ball) => ball.parent?.position.x);
    expect(xs).toContain(39);
  });

  it("frees its geometry and materials", () => {
    const pool = createFlashPool();
    const [ball] = (() => {
      pool.explode(0, 1, 0);
      return visibleFireballs(pool);
    })();
    const geometry = vi.spyOn(ball.geometry, "dispose");
    const material = vi.spyOn(ball.material as Material, "dispose");

    pool.dispose();

    expect(geometry).toHaveBeenCalled();
    expect(material).toHaveBeenCalledOnce();
  });
});
