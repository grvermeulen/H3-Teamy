import { Group, PerspectiveCamera } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "../render/renderScene";
import { createArenaPlayer } from "../sim/roster";
import type { ArenaPlayerState } from "../sim/types";
import {
  EFFECT_PARTICLES,
  REAL_ENTITY_FACTORIES,
  createCast3d,
  type CastFrame,
} from "./cast3d";
import { createCharacter } from "./characters";
import { createEffects3d } from "./effects3d";
import type { EntityFactories } from "./entities";
import { createPickup3d } from "./pickups3d";
import { createVehicle3d } from "./vehicles3d";

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

beforeEach(() => {
  effectsMade.length = 0;
  vi.mocked(createEffects3d).mockClear();
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
    character: vi.fn(poseable),
    vehicle: vi.fn(poseable),
    pickup: vi.fn(poseable),
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
    expect(REAL_ENTITY_FACTORIES).toEqual({
      character: createCharacter,
      vehicle: createVehicle3d,
      pickup: createPickup3d,
    });
  });

  it("syncs the cast, then bursts and advances the effects, every frame", () => {
    const factories = fakeFactories();
    const cast = createCast3d(factories);
    const frame = frameOf();
    cast.update(frame, FOCUS, new PerspectiveCamera());
    expect(factories.character).toHaveBeenCalledWith("player", undefined);
    const [effects] = effectsMade;
    expect(effects!.object).toBeInstanceOf(Group);
    expect((effects!.object as Group).parent).toBe(cast.object);
    expect(effects!.sync).toHaveBeenCalledWith(frame.scene, FOCUS);
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
  });

  it("disposes cleanly before the first frame", () => {
    expect(() => createCast3d(fakeFactories()).dispose()).not.toThrow();
  });
});
