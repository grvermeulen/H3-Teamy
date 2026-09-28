import { Group, PerspectiveCamera, type Vector3 } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "../render/renderScene";
import { createArenaPlayer } from "../sim/roster";
import type { ArenaPlayerState } from "../sim/types";
import { createVehicle } from "../sim/vehicle";
import {
  EFFECT_PARTICLES,
  REAL_ENTITY_FACTORIES,
  createCast3d,
  type CastFrame,
} from "./cast3d";
import { createDestruction3d } from "./destruction3d";
import { createEffects3d } from "./effects3d";
import type { EntityFactories } from "./entities";
import { createPickup3d } from "./pickups3d";
import type { ViewModelPass } from "./viewModelPass";

const effectsMade = vi.hoisted(
  () =>
    [] as {
      object: unknown;
      sync: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }[],
);

vi.mock("./effects3d", async () => {
  const { Group: EffectsGroup } = await import("three");
  return {
    createEffects3d: vi.fn(() => {
      const effects = {
        object: new EffectsGroup(),
        smoke: {},
        sync: vi.fn(),
        update: vi.fn(),
        dispose: vi.fn(),
      };
      effectsMade.push(effects);
      return effects;
    }),
  };
});

const destructionMade = vi.hoisted(
  () =>
    [] as {
      object: unknown;
      update: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }[],
);

vi.mock("./destruction3d", async () => {
  const { Group: DestructionGroup } = await import("three");
  return {
    createDestruction3d: vi.fn(() => {
      const destruction = {
        object: new DestructionGroup(),
        collapse: vi.fn(),
        setRubble: vi.fn(),
        knockOver: vi.fn(),
        update: vi.fn(),
        dispose: vi.fn(),
      };
      destructionMade.push(destruction);
      return destruction;
    }),
  };
});

beforeEach(() => {
  effectsMade.length = 0;
  destructionMade.length = 0;
  vi.mocked(createEffects3d).mockClear();
  vi.mocked(createDestruction3d).mockClear();
});

const FOCUS = { x: 3, y: 4 };

function fakeFactories(): EntityFactories & {
  character: ReturnType<typeof vi.fn>;
} {
  const poseable = (): { object: Group; update(): void; dispose(): void } => ({
    object: new Group(),
    update: vi.fn(),
    dispose: vi.fn(),
  });
  return {
    character: vi.fn(() => ({
      ...poseable(),
      muzzleWorld: vi.fn(() => false),
    })),
    vehicle: vi.fn(poseable),
    pickup: vi.fn(poseable),
  };
}

/** A hands-and-cockpit pass that records what it was asked to show. */
function fakePass(): ViewModelPass & {
  update: ReturnType<typeof vi.fn>;
  muzzleWorld: ReturnType<typeof vi.fn>;
} {
  return {
    update: vi.fn(() => null),
    muzzleWorld: vi.fn(() => false),
    dispose: vi.fn(),
  };
}

function you(extra: Partial<ArenaPlayerState> = {}): ArenaPlayerState {
  return { ...createArenaPlayer([3, 4], 0), id: 1, ...extra };
}

function frameOf(partial: Partial<CastFrame> = {}): CastFrame {
  const scene = {
    localPlayerId: 1,
    players: [you()],
    peds: [],
    cops: [],
    pickups: [],
    vehicles: [],
    bullets: [],
    effects: [],
    tick: 90,
  } as unknown as Scene;
  return {
    scene,
    dt: 0.02,
    mode: "third",
    aim: 0.4,
    quality: "auto",
    ...partial,
  };
}

describe("createCast3d", () => {
  it("builds the real characters, vehicles and pickups by default", () => {
    expect(REAL_ENTITY_FACTORIES).toMatchObject({
      character: expect.any(Function),
      characterVariant: expect.any(Function),
      dressCharacter: expect.any(Function),
      vehicle: expect.any(Function),
      vehicleVariant: expect.any(Function),
      pickup: createPickup3d,
    });
  });

  it("syncs the cast, then bursts and advances the effects, every frame", () => {
    const factories = fakeFactories();
    const cast = createCast3d(factories);
    const frame = frameOf();
    cast.update(frame, FOCUS, new PerspectiveCamera());
    expect(factories.character).toHaveBeenCalledWith(
      "player",
      undefined,
      expect.objectContaining({ id: expect.any(Number) }),
    );
    const [effects] = effectsMade;
    expect(effects!.object).toBeInstanceOf(Group);
    expect((effects!.object as Group).parent).toBe(cast.object);
    expect(effects!.sync).toHaveBeenCalledWith(
      frame.scene,
      FOCUS,
      false,
      expect.any(Map),
    );
    expect(effects!.update).toHaveBeenCalledWith(0.02);
    const [synced] = effects!.sync.mock.invocationCallOrder;
    const [updated] = effects!.update.mock.invocationCallOrder;
    expect(synced).toBeLessThan(updated!);
  });

  it("sizes the particle budget by the first frame's quality and keeps it", () => {
    const cast = createCast3d(fakeFactories());
    cast.update(frameOf({ quality: "low" }), FOCUS, new PerspectiveCamera());
    cast.update(frameOf({ quality: "high" }), FOCUS, new PerspectiveCamera());
    expect(createEffects3d).toHaveBeenCalledTimes(1);
    expect(createEffects3d).toHaveBeenCalledWith({
      maxParticles: EFFECT_PARTICLES.low,
    });
    expect(effectsMade[0]!.update).toHaveBeenCalledTimes(2);
  });

  it("makes the destruction with the effects, lending it their dust, and advances it after them", () => {
    const cast = createCast3d(fakeFactories());
    expect(cast.destruction()).toBeNull();

    cast.update(frameOf(), FOCUS, new PerspectiveCamera());
    cast.update(frameOf({ dt: 0.03 }), FOCUS, new PerspectiveCamera());

    const [effects] = effectsMade;
    const [destruction] = destructionMade;
    expect(createDestruction3d).toHaveBeenCalledTimes(1);
    expect(createDestruction3d).toHaveBeenCalledWith(
      (effects as unknown as { smoke: unknown }).smoke,
    );
    expect(cast.destruction()).toBe(destruction);
    expect((destruction!.object as Group).parent).toBe(cast.object);
    expect(destruction!.update.mock.calls).toEqual([[0.02], [0.03]]);
    const [effectsUpdated] = effects!.update.mock.invocationCallOrder;
    const [destructionUpdated] = destruction!.update.mock.invocationCallOrder;
    expect(effectsUpdated).toBeLessThan(destructionUpdated!);
  });

  it("shows the hands only in first person while you are alive and on foot", () => {
    const cast = createCast3d(fakeFactories());
    const camera = new PerspectiveCamera();
    expect(cast.update(frameOf(), FOCUS, camera)).toBeNull();
    const first = frameOf({ mode: "first" });
    expect(cast.update(first, FOCUS, camera)).not.toBeNull();
    const driving = frameOf({ mode: "first" });
    driving.scene.players = [you({ vehicleId: 9 })];
    expect(cast.update(driving, FOCUS, camera)).toBeNull();
    const dead = frameOf({ mode: "first" });
    dead.scene.players = [you({ diedAtTick: 80 })];
    expect(cast.update(dead, FOCUS, camera)).toBeNull();
  });

  it("asks for the cockpit at the wheel in first person, the hands on foot, and neither when dead", () => {
    const pass = fakePass();
    const cast = createCast3d(fakeFactories(), pass);
    const camera = new PerspectiveCamera();
    const driving = frameOf({ mode: "first" });
    driving.scene.players = [you({ vehicleId: 9, driveSteer: 0.5 })];
    driving.scene.vehicles = [
      { ...createVehicle(9, "van", [3, 4], 0.3, 6), velocityX: 5 },
    ];
    cast.update(driving, FOCUS, camera);
    expect(pass.update).toHaveBeenLastCalledWith(camera, null, {
      kind: "van",
      colour: 6,
      steer: 0.5,
      speedMps: expect.any(Number),
      siren: false,
      tick: 90,
      dt: 0.02,
      x: 3,
      y: 4,
      heading: 0.3,
    });
    cast.update(frameOf({ mode: "first" }), FOCUS, camera);
    expect(pass.update).toHaveBeenLastCalledWith(
      camera,
      expect.objectContaining({ weapon: "pistol" }),
      null,
    );
    const dead = frameOf({ mode: "first" });
    dead.scene.players = [you({ diedAtTick: 80 })];
    cast.update(dead, FOCUS, camera);
    expect(pass.update).toHaveBeenLastCalledWith(camera, null, null);
  });

  it("drives from the chase camera without a cockpit, and from a wreck without one", () => {
    const pass = fakePass();
    const cast = createCast3d(fakeFactories(), pass);
    const camera = new PerspectiveCamera();
    const driving = frameOf();
    driving.scene.players = [you({ vehicleId: 9 })];
    driving.scene.vehicles = [createVehicle(9, "sedan", [3, 4], 0, 1)];
    cast.update(driving, FOCUS, camera);
    expect(pass.update).toHaveBeenLastCalledWith(camera, null, null);
    const wreck = frameOf({ mode: "first" });
    wreck.scene.players = [you({ vehicleId: 9 })];
    wreck.scene.vehicles = [
      { ...createVehicle(9, "sedan", [3, 4], 0, 1), wrecked: true },
    ];
    cast.update(wreck, FOCUS, camera);
    expect(pass.update).toHaveBeenLastCalledWith(camera, null, null);
  });

  it("leaves your own muzzle flame to the hands in first person", () => {
    const cast = createCast3d(fakeFactories());
    const first = frameOf({ mode: "first" });
    cast.update(first, FOCUS, new PerspectiveCamera());
    expect(effectsMade[0]!.sync).toHaveBeenCalledWith(
      first.scene,
      FOCUS,
      true,
      expect.any(Map),
    );
  });

  it("keeps your own muzzle flame in the world when no hands are drawn: a first-person drive-by", () => {
    const cast = createCast3d(fakeFactories());
    const driving = frameOf({ mode: "first" });
    driving.scene.players = [you({ vehicleId: 9 })];

    const hands = cast.update(driving, FOCUS, new PerspectiveCamera());

    expect(hands).toBeNull();
    expect(effectsMade[0]!.sync).toHaveBeenCalledWith(
      driving.scene,
      FOCUS,
      false,
      expect.any(Map),
    );
  });

  it("hands the effects every shooter's muzzle, yours from the drawn gun in first person", () => {
    const pass = fakePass();
    // Like the real pass: a muzzle only in a frame that showed the hands.
    pass.muzzleWorld.mockImplementation((target: Vector3) => {
      if (pass.update.mock.calls.at(-1)?.[1] === null) return false;
      target.set(3.4, 1.5, 4.1);
      return true;
    });
    const factories = fakeFactories();
    factories.character.mockImplementation(() => ({
      object: new Group(),
      update: vi.fn(),
      dispose: vi.fn(),
      muzzleWorld: vi.fn((target: Vector3) => {
        target.set(3.6, 1.4, 4);
        return true;
      }),
    }));
    const cast = createCast3d(factories, pass);
    const camera = new PerspectiveCamera();
    cast.update(frameOf(), FOCUS, camera);
    const [, , , thirdPerson] = effectsMade[0]!.sync.mock.calls.at(-1)!;
    expect((thirdPerson as Map<number, Vector3>).get(1)!.toArray()).toEqual([
      3.6, 1.4, 4,
    ]);
    cast.update(frameOf({ mode: "first" }), FOCUS, camera);
    const [, , , firstPerson] = effectsMade[0]!.sync.mock.calls.at(-1)!;
    expect((firstPerson as Map<number, Vector3>).get(1)!.toArray()).toEqual([
      3.4, 1.5, 4.1,
    ]);
    const [posed] = pass.update.mock.invocationCallOrder.slice(-1);
    const [synced] = effectsMade[0]!.sync.mock.invocationCallOrder.slice(-1);
    expect(posed).toBeLessThan(synced!);
  });

  it("draws characters beyond 45 m simply at 'laag', and every one detailed otherwise", () => {
    const simple: boolean[] = [];
    const factories = fakeFactories();
    const build = factories.character.getMockImplementation();
    factories.character.mockImplementation(
      (look: string, hue?: number, who?: { simple: boolean }) => {
        simple.push(who?.simple ?? false);
        return build?.(look, hue, who);
      },
    );
    const far = you({ id: 2, x: FOCUS.x + 60, y: FOCUS.y });
    const scene = { ...frameOf().scene, players: [you(), far] } as Scene;
    createCast3d(factories).update(
      frameOf({ scene, quality: "low" }),
      FOCUS,
      new PerspectiveCamera(),
    );
    expect(simple).toEqual([false, true]);
    simple.length = 0;
    createCast3d(factories).update(
      frameOf({ scene, quality: "auto" }),
      FOCUS,
      new PerspectiveCamera(),
    );
    expect(simple).toEqual([false, false]);
  });

  it("stands the mission contacts in the street with the cast's own characters", () => {
    const factories = fakeFactories();
    const cast = createCast3d(factories);
    const noor = { id: "noor", x: 5, y: 4, look: "ped2" as const };

    cast.update(frameOf(), FOCUS, new PerspectiveCamera(), [noor]);

    expect(factories.character).toHaveBeenCalledWith(
      "ped2",
      undefined,
      expect.objectContaining({ simple: false }),
    );
    const contact = factories.character.mock.results.at(-1)!.value as {
      object: Group;
    };
    let root = contact.object.parent;
    while (root?.parent) root = root.parent;
    expect(root).toBe(cast.object);
    cast.dispose();
    expect(
      (contact as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose,
    ).toHaveBeenCalledTimes(1);
  });

  it("hides your body in first person", () => {
    const factories = fakeFactories();
    const cast = createCast3d(factories);
    cast.update(frameOf({ mode: "first" }), FOCUS, new PerspectiveCamera());
    const body = factories.character.mock.results[0]!.value as {
      object: Group;
    };
    expect(body.object.visible).toBe(false);
  });

  it("disposes the cast, the effects and the hands", () => {
    const factories = fakeFactories();
    const cast = createCast3d(factories);
    cast.update(frameOf(), FOCUS, new PerspectiveCamera());
    cast.dispose();
    const body = factories.character.mock.results[0]!.value as {
      dispose: ReturnType<typeof vi.fn>;
    };
    expect(body.dispose).toHaveBeenCalledTimes(1);
    expect(effectsMade[0]!.dispose).toHaveBeenCalledTimes(1);
    const [destruction] = destructionMade;
    expect(destruction!.dispose).toHaveBeenCalledTimes(1);
    const [freedDestruction] = destruction!.dispose.mock.invocationCallOrder;
    const [freedEffects] = effectsMade[0]!.dispose.mock.invocationCallOrder;
    expect(freedDestruction).toBeLessThan(freedEffects!);
  });

  it("disposes cleanly before the first frame", () => {
    expect(() => createCast3d(fakeFactories()).dispose()).not.toThrow();
  });
});
