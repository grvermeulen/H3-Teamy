import { describe, expect, it, vi } from "vitest";
import {
  AdditiveBlending,
  InstancedMesh,
  Mesh,
  PointLight,
  Points,
  Vector3,
  type BufferAttribute,
  type Material,
  type Object3D,
  type ShaderMaterial,
} from "three";
import type {
  ArenaPlayerState,
  BulletState,
  CopState,
  EffectState,
  VehicleState,
} from "../sim/types";
import { WEAPONS } from "../sim/weapons";
import {
  EXPLOSION_DEBRIS_COUNT,
  EXPLOSION_SMOKE_COUNT,
  IMPACT_SPARK_COUNT,
} from "./bursts";
import { PERSON_CHEST_HEIGHT_M } from "./coords";
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

  it("releases an explosion's light 0.25 s after the frame it lit", () => {
    const effects = createEffects3d({ maxParticles: 600 });
    effects.sync(scene({ effects: [EXPLOSION] }));
    effects.update(1 / 60);

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

  it("keeps only the light of your own muzzle flash when the view model shows its own", () => {
    const yours: EffectState = { ...EXPLOSION, kind: "muzzle", x: 10, y: 10 };
    const theirs: EffectState = { ...yours, id: 6, x: 30 };
    const effects = createEffects3d({ maxParticles: 600 });

    effects.sync(
      scene({ effects: [yours], players: [player(10.4, 10)] }),
      undefined,
      true,
    );
    effects.update(0.001);

    expect(fireParticles(effects.object)).toBe(0);
    expect(litLights(effects.object)).toHaveLength(1);
    effects.sync(
      scene({ effects: [yours, theirs], players: [player(10.4, 10)] }),
      undefined,
      true,
    );
    effects.update(0.001);
    expect(fireParticles(effects.object)).toBeGreaterThan(0);
  });

  it("draws your own muzzle flame when the view model does not show one", () => {
    const yours: EffectState = { ...EXPLOSION, kind: "muzzle", x: 10, y: 10 };
    const effects = createEffects3d({ maxParticles: 600 });

    effects.sync(scene({ effects: [yours], players: [player(10.4, 10)] }));
    effects.update(0.001);

    expect(fireParticles(effects.object)).toBeGreaterThan(0);
  });

  it("lights a muzzle flash at its shooter's muzzle, the nearest one within reach", () => {
    const flash: EffectState = { ...EXPLOSION, kind: "muzzle", x: 10, y: 10 };
    const muzzles = new Map([
      [7, new Vector3(10.8, 1.45, 10.1)],
      [30, new Vector3(11.9, 1.4, 10)],
      [31, new Vector3(40, 1.4, 10)],
    ]);
    const effects = createEffects3d({ maxParticles: 600 });

    effects.sync(scene({ effects: [flash] }), undefined, false, muzzles);
    effects.update(0.001);

    const [light] = litLights(effects.object);
    expect(light!.position.toArray()).toEqual([10.8, 1.45, 10.1]);
  });

  it("lights a flash nobody's muzzle is near just ahead of the shooter, as before", () => {
    const flash: EffectState = { ...EXPLOSION, kind: "muzzle", x: 10, y: 10 };
    const effects = createEffects3d({ maxParticles: 600 });

    effects.sync(
      scene({ effects: [flash] }),
      undefined,
      false,
      new Map([[30, new Vector3(20, 1.4, 10)]]),
    );
    effects.update(0.001);

    const [light] = litLights(effects.object);
    expect(light!.position.y).toBeCloseTo(PERSON_CHEST_HEIGHT_M);
    expect(light!.position.x).toBeGreaterThan(10);
    expect(light!.position.x).toBeLessThan(11);
  });

  it("moves your own flash's light to the drawn gun in first person, without a flame", () => {
    const yours: EffectState = { ...EXPLOSION, kind: "muzzle", x: 10, y: 10 };
    const drawnGun = new Vector3(10.3, 1.5, 10.15);
    const cop = new Vector3(10.5, 1.4, 10.05);
    const effects = createEffects3d({ maxParticles: 600 });

    effects.sync(
      scene({ effects: [yours], players: [player(10, 10)] }),
      undefined,
      true,
      new Map([
        [30, cop],
        [1, drawnGun],
      ]),
    );
    effects.update(0.001);

    expect(fireParticles(effects.object)).toBe(0);
    const [light] = litLights(effects.object);
    expect(light!.position.toArray()).toEqual(drawnGun.toArray());
  });

  it("gives a flash lit at an officer beside you to the officer, flame and all", () => {
    const theirs: EffectState = {
      ...EXPLOSION,
      kind: "muzzle",
      x: 10.9,
      y: 10,
    };
    const yourGun = new Vector3(10.3, 1.5, 10.15);
    const copGun = new Vector3(11.4, 1.4, 10.05);
    const officer = { id: 30, x: 10.9, y: 10 } as CopState;
    const effects = createEffects3d({ maxParticles: 600 });

    effects.sync(
      scene({ effects: [theirs], players: [player(10, 10)], cops: [officer] }),
      undefined,
      true,
      new Map([
        [1, yourGun],
        [30, copGun],
      ]),
    );
    effects.update(0.001);

    expect(fireParticles(effects.object)).toBeGreaterThan(0);
    const [light] = litLights(effects.object);
    expect(light!.position.toArray()).toEqual(copGun.toArray());
  });

  it("leaves a drive-by flash at its shooter, not on a gun that happens to be near", () => {
    const driveBy: EffectState = { ...EXPLOSION, kind: "muzzle", x: 10, y: 10 };
    const driver = { id: 5, x: 10, y: 10 } as ArenaPlayerState;
    const nearbyGun = new Vector3(10.9, 1.4, 10.2);
    const effects = createEffects3d({ maxParticles: 600 });

    effects.sync(
      scene({ effects: [driveBy], players: [driver] }),
      undefined,
      false,
      new Map([[30, nearbyGun]]),
    );
    effects.update(0.001);

    const [light] = litLights(effects.object);
    expect(light!.position.toArray()).not.toEqual(nearbyGun.toArray());
    expect(light!.position.y).toBeCloseTo(PERSON_CHEST_HEIGHT_M);
  });

  it("puts a drive-by's flash at the gun held out of the car window", () => {
    const driveBy: EffectState = { ...EXPLOSION, kind: "muzzle", x: 10, y: 10 };
    const driver = { id: 5, x: 10, y: 10 } as ArenaPlayerState;
    const outOfWindow = new Vector3(10.3, 1.05, 8.85);
    const effects = createEffects3d({ maxParticles: 600 });

    effects.sync(
      scene({ effects: [driveBy], players: [driver] }),
      undefined,
      false,
      new Map([[5, outOfWindow]]),
    );
    effects.update(0.001);

    const [light] = litLights(effects.object);
    expect(light!.position.toArray()).toEqual(outOfWindow.toArray());
  });

  it("starts the rounds of a known shooter at their muzzle", () => {
    const effects = createEffects3d({ maxParticles: 600 });
    const round: BulletState = {
      id: 9,
      ownerId: 7,
      ignoreVehicleId: null,
      x: 10,
      y: 10,
      directionX: 1,
      directionY: 0,
      speedMps: 110,
      rangeLeftM: WEAPONS.uzi.rangeM,
      damage: 10,
      weapon: "uzi",
    };
    const muzzle = new Vector3(10.7, 1.45, 10.1);

    effects.sync(
      scene({ bullets: [round] }),
      undefined,
      false,
      new Map([[7, muzzle]]),
    );

    const tracers = effects.object.getObjectByName("tracers") as Mesh;
    const position = tracers.geometry.getAttribute(
      "position",
    ) as BufferAttribute;
    expect(
      new Vector3().fromBufferAttribute(position, 0).distanceTo(muzzle),
    ).toBeCloseTo(0);
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
