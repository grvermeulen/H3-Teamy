import { describe, expect, it, vi } from "vitest";
import {
  AdditiveBlending,
  InstancedMesh,
  Mesh,
  PointLight,
  Points,
  type Material,
  type Object3D,
  type ShaderMaterial,
} from "three";
import type {
  ArenaPlayerState,
  BulletState,
  EffectState,
  VehicleState,
} from "../sim/types";
import { WEAPONS } from "../sim/weapons";
import {
  EXPLOSION_DEBRIS_COUNT,
  EXPLOSION_SMOKE_COUNT,
  IMPACT_SPARK_COUNT,
} from "./bursts";
import { createEffects3d, type EffectsScene } from "./effects3d";

const EXPLOSION: EffectState = {
  id: 5,
  kind: "explosion",
  x: 40,
  y: 60,
  angle: 0,
  bornTick: 100,
  ttlTicks: 18,
};

const WRECK: VehicleState = {
  id: 3,
  kind: "sedan",
  x: 40,
  y: 60,
  heading: 0,
  velocityX: 0,
  velocityY: 0,
  health: 0,
  wrecked: true,
  colour: 0,
};

function scene(parts: Partial<EffectsScene> = {}): EffectsScene {
  return {
    effects: [],
    bullets: [],
    vehicles: [],
    players: [],
    localPlayerId: 1,
    ...parts,
  };
}

function player(x: number, y: number): ArenaPlayerState {
  return { id: 1, x, y } as ArenaPlayerState;
}

/** Flash lights giving off light; dark ones stay in the scene at intensity 0. */
function litLights(root: Object3D): PointLight[] {
  const lit: PointLight[] = [];
  root.traverse((node) => {
    if (node instanceof PointLight && node.intensity > 0) lit.push(node);
  });
  return lit;
}

/** Ruling 21: the lit materials' light count, which must never change. */
function visibleLightCount(root: Object3D): number {
  let count = 0;
  root.traverseVisible((node) => {
    if (node instanceof PointLight) count += 1;
  });
  return count;
}

function burningFireballs(root: Object3D): Mesh[] {
  const found: Mesh[] = [];
  root.traverse((node) => {
    if (
      node instanceof Mesh &&
      node.name === "fireball" &&
      node.parent?.visible
    )
      found.push(node);
  });
  return found;
}

function fireParticles(root: Object3D): number {
  let drawn = 0;
  root.traverse((node) => {
    if (
      node instanceof Points &&
      (node.material as ShaderMaterial).blending === AdditiveBlending
    )
      drawn = node.geometry.drawRange.count;
  });
  return drawn;
}

function debrisChunks(root: Object3D): number {
  let count = 0;
  root.traverse((node) => {
    if (node instanceof InstancedMesh) count += node.count;
  });
  return count;
}

describe("createEffects3d", () => {
  it("bursts one explosion per new effect id and never twice for the same id", () => {
    const effects = createEffects3d({ maxParticles: 600 });

    effects.sync(scene({ effects: [EXPLOSION] }));
    effects.sync(scene({ effects: [EXPLOSION] }));

    expect(burningFireballs(effects.object)).toHaveLength(1);
    expect(litLights(effects.object)).toHaveLength(1);
    expect(effects.smoke.alive()).toBe(EXPLOSION_SMOKE_COUNT);
    expect(EXPLOSION_SMOKE_COUNT).toBe(24);

    effects.sync(scene({ effects: [EXPLOSION, { ...EXPLOSION, id: 6 }] }));

    expect(burningFireballs(effects.object)).toHaveLength(2);
    expect(effects.smoke.alive()).toBe(EXPLOSION_SMOKE_COUNT * 2);
  });

  it("forgets an effect once it has left the scene", () => {
    const effects = createEffects3d({ maxParticles: 600 });
    effects.sync(scene({ effects: [EXPLOSION] }));
    effects.sync(scene());

    effects.sync(scene({ effects: [EXPLOSION] }));

    expect(effects.smoke.alive()).toBe(EXPLOSION_SMOKE_COUNT * 2);
  });

  it("releases an explosion's light after 0.25 s", () => {
    const effects = createEffects3d({ maxParticles: 600 });
    effects.sync(scene({ effects: [EXPLOSION] }));

    effects.update(0.2);
    expect(litLights(effects.object)).toHaveLength(1);
    effects.update(0.05);
    expect(litLights(effects.object)).toHaveLength(0);
  });

  it("keeps four visible flash lights before, during and after an explosion", () => {
    const effects = createEffects3d({ maxParticles: 600 });
    const counts = [visibleLightCount(effects.object)];

    effects.sync(scene({ effects: [EXPLOSION] }));
    counts.push(visibleLightCount(effects.object));
    effects.update(0.1);
    counts.push(visibleLightCount(effects.object));
    effects.update(0.5);
    counts.push(visibleLightCount(effects.object));

    expect(counts).toEqual([4, 4, 4, 4]);
  });

  it("throws 12 debris chunks from an explosion, at the blast", () => {
    const effects = createEffects3d({ maxParticles: 600 });

    effects.sync(scene({ effects: [EXPLOSION] }));
    effects.update(0.01);

    expect(EXPLOSION_DEBRIS_COUNT).toBe(12);
    expect(debrisChunks(effects.object)).toBe(EXPLOSION_DEBRIS_COUNT);
    const [ball] = burningFireballs(effects.object);
    expect(ball.parent?.position.x).toBe(EXPLOSION.x);
    expect(ball.parent?.position.z).toBe(EXPLOSION.y);
  });

  it("sprays six sparks from a bullet impact", () => {
    const effects = createEffects3d({ maxParticles: 600 });

    effects.sync(scene({ effects: [{ ...EXPLOSION, kind: "impact" }] }));
    effects.update(0.001);

    expect(IMPACT_SPARK_COUNT).toBe(6);
    expect(fireParticles(effects.object)).toBe(IMPACT_SPARK_COUNT);
    expect(litLights(effects.object)).toHaveLength(0);
  });

  it("pops a muzzle flash with a short light", () => {
    const effects = createEffects3d({ maxParticles: 600 });

    effects.sync(scene({ effects: [{ ...EXPLOSION, kind: "muzzle" }] }));
    effects.update(0.001);

    expect(fireParticles(effects.object)).toBeGreaterThan(0);
    expect(litLights(effects.object)).toHaveLength(1);
    effects.update(0.05);
    expect(litLights(effects.object)).toHaveLength(0);
  });

  it("draws the rounds in flight as tracers", () => {
    const effects = createEffects3d({ maxParticles: 600 });
    const round: BulletState = {
      id: 9,
      ownerId: 1,
      ignoreVehicleId: null,
      x: 10,
      y: 10,
      directionX: 1,
      directionY: 0,
      speedMps: 100,
      rangeLeftM: WEAPONS.uzi.rangeM - 10,
      damage: 10,
      weapon: "uzi",
    };

    effects.sync(scene({ bullets: [round] }));

    const tracers = effects.object.getObjectByName("tracers") as Mesh;
    expect(tracers.geometry.drawRange.count).toBe(2);
  });

  it("smokes wrecks near the local player, and not those out of range", () => {
    const near = createEffects3d({ maxParticles: 600 });
    near.sync(scene({ vehicles: [WRECK], players: [player(45, 60)] }));
    expect(near.smoke.alive()).toBeGreaterThan(0);

    const far = createEffects3d({ maxParticles: 600 });
    far.sync(scene({ vehicles: [WRECK] }), { x: 1000, y: 1000 });
    expect(far.smoke.alive()).toBe(0);
  });

  it("splits its particle budget between fire and smoke", () => {
    const effects = createEffects3d({ maxParticles: 1000 });

    let total = 0;
    effects.object.traverse((node) => {
      if (node instanceof Points)
        total += node.geometry.getAttribute("position").count;
    });

    expect(total).toBe(1000);
    expect(effects.smoke.capacity).toBeGreaterThan(500);
  });

  it("frees everything it built", () => {
    const effects = createEffects3d({ maxParticles: 600 });
    const disposals: ReturnType<typeof vi.spyOn>[] = [];
    effects.object.traverse((node) => {
      if (node instanceof Points || node instanceof InstancedMesh)
        disposals.push(vi.spyOn(node.material as Material, "dispose"));
    });

    effects.dispose();

    expect(disposals.length).toBe(3);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
  });
});
