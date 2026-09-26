import { Group } from "three";
import { describe, expect, it, vi } from "vitest";
import type { Scene } from "../render/renderScene";
import { createArenaPlayer } from "../sim/roster";
import type {
  ArenaPlayerState,
  CopState,
  EffectState,
  PedState,
  PickupKind,
  PickupState,
  VehicleKind,
  VehicleState,
} from "../sim/types";
import { VEHICLE_SPECS, createVehicle, forwardSpeed } from "../sim/vehicle";
import { pedLookOf, type CharacterLook } from "./characterLooks";
import type { PoseInput } from "./characterPose";
import { headingToRotationY } from "./coords";
import {
  CHARACTER_DRAW_DISTANCE_M,
  COP_AIM_RANGE_M,
  FREE_LIST_CAP,
  VEHICLE_DRAW_DISTANCE_M,
  createEntitySync,
  type EntityFactories,
  type EntitySync,
  type EntityView,
} from "./entities";
import { vestHueOf } from "./entityMotion";
import type { Vehicle3dInput } from "./vehicles3d";

const TICK = 300;
const FRAME_S = 1 / 60;
const ORIGIN = { x: 0, y: 0 };
const THIRD: EntityView = { firstPerson: false, aim: 0 };
const FIRST: EntityView = { firstPerson: true, aim: 0 };

type FakeCharacter = {
  object: Group;
  look: CharacterLook;
  vestHue: number | undefined;
  /** A copy of the latest pose: the sync reuses one input object. */
  pose: PoseInput | null;
  update: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

type FakeVehicle = {
  object: Group;
  kind: VehicleKind;
  colour: number;
  /** The latest input and the hull's rotation at the moment `update` ran. */
  input: (Vehicle3dInput & { rotationY: number }) | null;
  update: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

type FakePickup = {
  object: Group;
  kind: PickupKind;
  input: { taken: boolean; tick: number } | null;
  update: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

/** Factories that record what they made; every fake copies its latest input. */
function fakeFactories(): {
  factories: EntityFactories;
  characters: FakeCharacter[];
  vehicles: FakeVehicle[];
  pickups: FakePickup[];
} {
  const characters: FakeCharacter[] = [];
  const vehicles: FakeVehicle[] = [];
  const pickups: FakePickup[] = [];
  const factories: EntityFactories = {
    character: vi.fn((look: CharacterLook, vestHue?: number) => {
      const fake: FakeCharacter = {
        object: new Group(),
        look,
        vestHue,
        pose: null,
        update: vi.fn((pose: PoseInput) => (fake.pose = { ...pose })),
        dispose: vi.fn(),
      };
      characters.push(fake);
      return fake;
    }),
    vehicle: vi.fn((kind: VehicleKind, colour: number) => {
      const fake: FakeVehicle = {
        object: new Group(),
        kind,
        colour,
        input: null,
        update: vi.fn((input: Vehicle3dInput) => {
          fake.input = { ...input, rotationY: fake.object.rotation.y };
        }),
        dispose: vi.fn(),
      };
      vehicles.push(fake);
      return fake;
    }),
    pickup: vi.fn((kind: PickupKind) => {
      const fake: FakePickup = {
        object: new Group(),
        kind,
        input: null,
        update: vi.fn((input: { taken: boolean; tick: number }) => {
          fake.input = { ...input };
        }),
        dispose: vi.fn(),
      };
      pickups.push(fake);
      return fake;
    }),
  };
  return { factories, characters, vehicles, pickups };
}

function sceneOf(partial: Partial<Scene>): Scene {
  return {
    localPlayerId: 1,
    players: [],
    peds: [],
    cops: [],
    pickups: [],
    vehicles: [],
    bullets: [],
    effects: [],
    tick: TICK,
    ...partial,
  } as unknown as Scene;
}

function player(
  id: number,
  x: number,
  y: number,
  extra: Partial<ArenaPlayerState> = {},
): ArenaPlayerState {
  return { ...createArenaPlayer([x, y], 0), id, ...extra };
}

function ped(
  id: number,
  x: number,
  y: number,
  extra: Partial<PedState> = {},
): PedState {
  return {
    id,
    x,
    y,
    facing: 0,
    health: 30,
    mode: "walk",
    modeUntilTick: 0,
    rail: null,
    fleeX: 0,
    fleeY: 0,
    ...extra,
  };
}

function cop(
  id: number,
  x: number,
  y: number,
  extra: Partial<CopState> = {},
): CopState {
  return {
    id,
    x,
    y,
    facing: 0,
    health: 100,
    weapon: "pistol",
    path: [],
    repathTick: 0,
    nextShotTick: 0,
    diedAtTick: null,
    ...extra,
  };
}

function car(
  id: number,
  x: number,
  y: number,
  extra: Partial<VehicleState> = {},
): VehicleState {
  return { ...createVehicle(id, "sedan", [x, y], 0, 2), ...extra };
}

function pickup(
  id: number,
  x: number,
  y: number,
  extra: Partial<PickupState> = {},
): PickupState {
  return { id, kind: "uzi", x, y, takenAtTick: null, ...extra };
}

function muzzle(x: number, y: number, bornTick = TICK): EffectState {
  return { id: 900, kind: "muzzle", x, y, angle: 0, bornTick, ttlTicks: 2 };
}

/** A second ped id that wears the same look as `id`. */
function sameLookAs(id: number): number {
  for (let other = id + 1; ; other += 1)
    if (pedLookOf(other) === pedLookOf(id)) return other;
}

function syncOf(): ReturnType<typeof fakeFactories> & { sync: EntitySync } {
  const fakes = fakeFactories();
  return { ...fakes, sync: createEntitySync(fakes.factories) };
}

describe("createEntitySync: characters", () => {
  it("dresses you, other players by vest hue, pedestrians by id and officers as cops", () => {
    const { sync, characters } = syncOf();
    const scene = sceneOf({
      players: [player(1, 0, 0), player(7, 5, 0)],
      peds: [ped(20, 10, 0)],
      cops: [cop(30, 15, 0)],
    });
    sync.update(scene, FRAME_S, ORIGIN, THIRD);
    expect(characters.map((character) => character.look)).toEqual([
      "player",
      "otherPlayer",
      pedLookOf(20),
      "cop",
    ]);
    expect(characters[0]!.vestHue).toBeUndefined();
    expect(characters[1]!.vestHue).toBe(vestHueOf(7));
    for (const character of characters)
      expect(character.object.parent).toBe(sync.group);
  });

  it("stands each character where the scene has it, turned to its facing", () => {
    const { sync, characters } = syncOf();
    const scene = sceneOf({ peds: [ped(20, 12, -34, { facing: 1.1 })] });
    sync.update(scene, FRAME_S, ORIGIN, THIRD);
    const { object } = characters[0]!;
    expect(object.position.toArray()).toEqual([12, 0, -34]);
    expect(object.rotation.y).toBe(headingToRotationY(1.1));
    expect(characters[0]!.pose).toMatchObject({ tick: TICK, dead: false });
  });

  it("keeps an entity's character frame to frame and reuses a released one for its look", () => {
    const { sync, characters, factories } = syncOf();
    const twin = sameLookAs(20);
    sync.update(sceneOf({ peds: [ped(20, 0, 0)] }), FRAME_S, ORIGIN, THIRD);
    sync.update(sceneOf({ peds: [ped(20, 1, 0)] }), FRAME_S, ORIGIN, THIRD);
    expect(factories.character).toHaveBeenCalledTimes(1);
    const { object } = characters[0]!;
    sync.update(sceneOf({}), FRAME_S, ORIGIN, THIRD);
    expect(object.visible).toBe(false);
    expect(object.parent).toBeNull();
    sync.update(sceneOf({ peds: [ped(twin, 3, 4)] }), FRAME_S, ORIGIN, THIRD);
    expect(factories.character).toHaveBeenCalledTimes(1);
    expect(object.parent).toBe(sync.group);
    expect(object.visible).toBe(true);
    expect(object.position.toArray()).toEqual([3, 0, 4]);
  });

  it("keeps at most a free list's worth of released characters per look", () => {
    const { sync, characters, factories } = syncOf();
    const ids = [20];
    while (ids.length < FREE_LIST_CAP + 8) ids.push(sameLookAs(ids.at(-1)!));
    const crowd = ids.map((id, index) => ped(id, index, 0));
    sync.update(sceneOf({ peds: crowd }), FRAME_S, ORIGIN, THIRD);
    sync.update(sceneOf({}), FRAME_S, ORIGIN, THIRD);
    const disposed = characters.filter(
      (character) => character.dispose.mock.calls.length > 0,
    );
    expect(disposed).toHaveLength(8);
    sync.update(sceneOf({ peds: crowd }), FRAME_S, ORIGIN, THIRD);
    expect(factories.character).toHaveBeenCalledTimes(ids.length + 8);
  });

  it("draws characters only within 180 m of the camera focus", () => {
    expect(CHARACTER_DRAW_DISTANCE_M).toBe(180);
    expect(VEHICLE_DRAW_DISTANCE_M).toBe(320);
    const { sync, characters } = syncOf();
    const near = CHARACTER_DRAW_DISTANCE_M - 1;
    const far = CHARACTER_DRAW_DISTANCE_M + 1;
    const focus = { x: 100, y: 100 };
    const scene = sceneOf({
      peds: [ped(20, 100 + near, 100), ped(21, 100, 100 + far)],
      cops: [cop(30, 100 - far, 100)],
      players: [player(7, 100, 100 - far)],
    });
    sync.update(scene, FRAME_S, focus, THIRD);
    expect(characters.map((character) => character.look)).toEqual([
      pedLookOf(20),
    ]);
  });

  it("hides your body in first person, and shows it in third person or once you are dead", () => {
    const { sync, characters } = syncOf();
    const alive = sceneOf({ players: [player(1, 0, 0), player(7, 3, 0)] });
    sync.update(alive, FRAME_S, ORIGIN, FIRST);
    const [you, friend] = characters;
    expect(you!.object.visible).toBe(false);
    expect(friend!.object.visible).toBe(true);
    sync.update(alive, FRAME_S, ORIGIN, THIRD);
    expect(you!.object.visible).toBe(true);
    const dead = sceneOf({ players: [player(1, 0, 0, { diedAtTick: 290 })] });
    sync.update(dead, FRAME_S, ORIGIN, FIRST);
    expect(you!.object.visible).toBe(true);
    expect(you!.pose).toMatchObject({ dead: true, aiming: false });
  });

  it("leaves players in a car to the car, and blinks a shielded one like the 2D view", () => {
    const { sync, characters } = syncOf();
    const driving = sceneOf({ players: [player(7, 0, 0, { vehicleId: 50 })] });
    sync.update(driving, FRAME_S, ORIGIN, THIRD);
    expect(characters).toHaveLength(0);
    const shielded = player(7, 0, 0, { invulnerableUntilTick: TICK + 60 });
    const blinkOff = sceneOf({ players: [shielded], tick: 4 * 5 });
    const blinkOn = sceneOf({ players: [shielded], tick: 4 * 4 });
    sync.update(blinkOff, FRAME_S, ORIGIN, THIRD);
    expect(characters[0]!.object.visible).toBe(false);
    sync.update(blinkOn, FRAME_S, ORIGIN, THIRD);
    expect(characters[0]!.object.visible).toBe(true);
  });

  it("disposes another player's hued character when it leaves, keeping none for reuse", () => {
    const { sync, characters, factories } = syncOf();
    const friend = sceneOf({ players: [player(7, 0, 0)] });
    sync.update(friend, FRAME_S, ORIGIN, THIRD);
    const [built] = characters;
    sync.update(sceneOf({}), FRAME_S, ORIGIN, THIRD);
    expect(built!.dispose).toHaveBeenCalledTimes(1);
    expect(built!.object.parent).toBeNull();
    sync.update(friend, FRAME_S, ORIGIN, THIRD);
    expect(factories.character).toHaveBeenCalledTimes(2);
    sync.dispose();
    expect(built!.dispose).toHaveBeenCalledTimes(1);
  });

  it("gives every other player the same vest hue each time their character is built", () => {
    const { sync, characters } = syncOf();
    const scene = sceneOf({ players: [player(7, 0, 0)] });
    sync.update(scene, FRAME_S, ORIGIN, THIRD);
    sync.update(sceneOf({}), FRAME_S, ORIGIN, THIRD);
    sync.update(
      sceneOf({ players: [player(8, 0, 0)] }),
      FRAME_S,
      ORIGIN,
      THIRD,
    );
    expect(characters[0]!.vestHue).toBe(vestHueOf(7));
    expect(characters[1]!.vestHue).toBe(vestHueOf(8));
    expect(vestHueOf(8)).not.toBe(vestHueOf(7));
    const elsewhere = fakeFactories();
    createEntitySync(elsewhere.factories).update(scene, FRAME_S, ORIGIN, THIRD);
    expect(elsewhere.characters[0]!.vestHue).toBe(characters[0]!.vestHue);
  });

  it("walks a pedestrian by its movement: speed from the position change, gait by distance", () => {
    const { sync, characters } = syncOf();
    for (let frame = 0; frame <= 120; frame += 1) {
      const scene = sceneOf({ peds: [ped(20, frame * 0.05, 0)] });
      sync.update(scene, FRAME_S, ORIGIN, THIRD);
    }
    const pose = characters[0]!.pose!;
    expect(pose.speed).toBeCloseTo(3, 2);
    expect(pose.phaseM).toBeGreaterThan(5.4);
    expect(pose.phaseM).toBeLessThanOrEqual(6);
    expect(pose.aiming).toBe(false);
    expect(pose.weapon).toBeNull();
  });

  it("uses a player's own speed from the simulation", () => {
    const { sync, characters } = syncOf();
    const scene = sceneOf({ players: [player(1, 0, 0, { speed: 4.5 })] });
    for (let frame = 0; frame < 120; frame += 1)
      sync.update(scene, FRAME_S, ORIGIN, THIRD);
    expect(characters[0]!.pose!.speed).toBeCloseTo(4.5, 2);
  });

  it("raises a player's gun but not fists or a bat, a cop's only near a living player", () => {
    const { sync, characters } = syncOf();
    const range = COP_AIM_RANGE_M;
    const scene = (target: ArenaPlayerState): Scene =>
      sceneOf({
        players: [
          player(1, 0, 0, { weapon: "rifle" }),
          player(2, 1, 0, { weapon: "bat" }),
          player(3, 2, 0, { weapon: "fist" }),
          target,
        ],
        peds: [ped(20, 0, 5)],
        cops: [cop(30, 50, 0), cop(31, -40, 0)],
      });
    sync.update(scene(player(4, 50 + range, 0)), FRAME_S, ORIGIN, THIRD);
    const aiming = (): boolean[] =>
      characters.map((character) => character.pose!.aiming);
    expect(characters.map((character) => character.pose!.weapon)).toEqual([
      "rifle",
      "bat",
      "fist",
      "pistol",
      null,
      "pistol",
      "pistol",
    ]);
    expect(aiming()).toEqual([true, false, false, true, false, true, false]);
    const dead = player(4, 50 + range, 0, { diedAtTick: 280 });
    sync.update(scene(dead), FRAME_S, ORIGIN, THIRD);
    expect(aiming()).toEqual([true, false, false, false, false, false, false]);
  });

  it("kicks a character whose gun a fresh muzzle flash lights, once, then eases back", () => {
    const { sync, characters } = syncOf();
    const officer = cop(30, 10, 10);
    const fired = sceneOf({ cops: [officer], effects: [muzzle(10.8, 10.4)] });
    sync.update(sceneOf({ cops: [officer] }), FRAME_S, ORIGIN, THIRD);
    expect(characters[0]!.pose!.recoil).toBe(0);
    sync.update(fired, FRAME_S, ORIGIN, THIRD);
    expect(characters[0]!.pose!.recoil).toBe(1);
    sync.update(fired, FRAME_S, ORIGIN, THIRD);
    expect(characters[0]!.pose!.recoil).toBeLessThan(1);
    expect(characters[0]!.pose!.recoil).toBeGreaterThan(0);
  });

  it("does not kick for a flash beyond the reach of the gun or long gone", () => {
    const { sync, characters } = syncOf();
    const scene = sceneOf({
      cops: [cop(30, 10, 10)],
      effects: [muzzle(12, 10), muzzle(10, 10, TICK - 5)],
    });
    sync.update(scene, FRAME_S, ORIGIN, THIRD);
    expect(characters[0]!.pose!.recoil).toBe(0);
  });

  it("kicks a player's melee swing, which leaves no flash, from the next-shot tick", () => {
    const { sync, characters } = syncOf();
    const swinger = player(1, 0, 0, { weapon: "bat", nextShotTick: 280 });
    sync.update(sceneOf({ players: [swinger] }), FRAME_S, ORIGIN, THIRD);
    expect(characters[0]!.pose!.recoil).toBe(0);
    const swung = { ...swinger, nextShotTick: TICK + 12 };
    sync.update(sceneOf({ players: [swung] }), FRAME_S, ORIGIN, THIRD);
    expect(characters[0]!.pose!.recoil).toBe(1);
    expect(sync.local.firedTick).toBe(TICK);
  });

  it("does not mistake a respawn, which resets the next-shot tick, for a swing", () => {
    const { sync, characters } = syncOf();
    const shooter = player(1, 0, 0, { nextShotTick: 200 });
    sync.update(sceneOf({ players: [shooter] }), FRAME_S, ORIGIN, THIRD);
    const dead = { ...shooter, diedAtTick: 250 };
    sync.update(sceneOf({ players: [dead] }), FRAME_S, ORIGIN, THIRD);
    const respawned = { ...shooter, nextShotTick: TICK, x: 40, y: 0 };
    sync.update(sceneOf({ players: [respawned] }), FRAME_S, ORIGIN, THIRD);
    expect(characters[0]!.pose!.recoil).toBe(0);
    expect(sync.local.firedTick).toBeNull();
  });

  it("kicks your own hands only when your next-shot tick moves on, never for a flash beside you", () => {
    const { sync, characters } = syncOf();
    const you = player(1, 0, 0, { nextShotTick: 280 });
    const officer = cop(30, 0.6, 0);
    const calm = sceneOf({ players: [you], cops: [officer] });
    const beside = sceneOf({
      players: [you],
      cops: [officer],
      effects: [muzzle(0.6, 0)],
    });
    sync.update(calm, FRAME_S, ORIGIN, FIRST);
    sync.update(beside, FRAME_S, ORIGIN, FIRST);
    expect(characters[0]!.pose!.recoil).toBe(0);
    expect(sync.local.firedTick).toBeNull();
    expect(characters[1]!.pose!.recoil).toBe(1);
    const fired = { ...you, nextShotTick: TICK + 8 };
    sync.update(sceneOf({ players: [fired] }), FRAME_S, ORIGIN, FIRST);
    expect(characters[0]!.pose!.recoil).toBe(1);
    expect(sync.local.firedTick).toBe(TICK);
  });

  it("still kicks another player by a fresh flash at their gun", () => {
    const { sync, characters } = syncOf();
    const friend = player(7, 10, 0, { nextShotTick: 280 });
    sync.update(sceneOf({ players: [friend] }), FRAME_S, ORIGIN, THIRD);
    const flashed = sceneOf({ players: [friend], effects: [muzzle(10.5, 0)] });
    sync.update(flashed, FRAME_S, ORIGIN, THIRD);
    expect(characters[0]!.pose!.recoil).toBe(1);
  });

  it("tells the view model your weapon, last shot and speed while you are on foot", () => {
    const { sync } = syncOf();
    const you = player(1, 0, 0, { weapon: "shotgun", speed: 2 });
    sync.update(sceneOf({ players: [you] }), FRAME_S, ORIGIN, FIRST);
    const fired = { ...you, nextShotTick: TICK + 10 };
    const scene = sceneOf({ players: [fired], effects: [muzzle(0, 0)] });
    sync.update(scene, FRAME_S, ORIGIN, FIRST);
    expect(sync.local).toMatchObject({
      onFoot: true,
      weapon: "shotgun",
      firedTick: TICK,
    });
    expect(sync.local.speed).toBeGreaterThan(0);
    const driving = sceneOf({ players: [{ ...you, vehicleId: 50 }] });
    sync.update(driving, FRAME_S, ORIGIN, FIRST);
    expect(sync.local.onFoot).toBe(false);
    const dead = sceneOf({ players: [{ ...you, diedAtTick: 290 }] });
    sync.update(dead, FRAME_S, ORIGIN, FIRST);
    expect(sync.local.onFoot).toBe(false);
  });
});

describe("createEntitySync: vehicles", () => {
  it("turns each car to its heading before updating it, with speed, siren and wreck", () => {
    const { sync, vehicles } = syncOf();
    const moving = car(50, 8, 9, {
      heading: 0.7,
      velocityX: 6,
      velocityY: 2,
      wrecked: true,
      health: 12,
    });
    const scene = sceneOf({
      vehicles: [moving],
      sirenVehicleIds: new Set([50]),
    });
    sync.update(scene, FRAME_S, ORIGIN, THIRD);
    const [fake] = vehicles;
    expect(fake).toMatchObject({ kind: "sedan", colour: 2 });
    expect(fake!.object.position.toArray()).toEqual([8, 0, 9]);
    expect(fake!.input).toMatchObject({
      rotationY: headingToRotationY(0.7),
      speed: forwardSpeed(moving),
      wrecked: true,
      siren: true,
      health: 12,
      tick: TICK,
      dt: FRAME_S,
      turretYaw: null,
    });
    sync.update(sceneOf({ vehicles: [moving] }), FRAME_S, ORIGIN, THIRD);
    expect(fake!.input!.siren).toBe(false);
  });

  it("steers by the driver's input, or by how fast the car turns when nobody drives it", () => {
    const { sync, vehicles } = syncOf();
    const rate = VEHICLE_SPECS.sedan.steerRateRadS * 0.5;
    for (let frame = 0; frame <= 60; frame += 1) {
      const heading = frame * rate * FRAME_S;
      const velocity = {
        velocityX: 10 * Math.cos(heading),
        velocityY: 10 * Math.sin(heading),
      };
      const scene = sceneOf({
        players: [player(1, 0, 0, { vehicleId: 51, driveSteer: -0.3 })],
        vehicles: [car(50, 0, 0, { heading, ...velocity }), car(51, 20, 0)],
      });
      sync.update(scene, FRAME_S, ORIGIN, THIRD);
    }
    expect(vehicles[0]!.input!.steer).toBeCloseTo(0.5, 2);
    expect(vehicles[1]!.input!.steer).toBe(-0.3);
  });

  it("aims a tank's turret along your aim, another driver's facing, or straight ahead", () => {
    const { sync, vehicles } = syncOf();
    const view: EntityView = { firstPerson: false, aim: 2.2 };
    const scene = sceneOf({
      players: [
        player(1, 0, 0, { vehicleId: 50 }),
        player(7, 30, 0, { vehicleId: 51, facing: -1 }),
      ],
      vehicles: [
        car(50, 0, 0, { kind: "tank" }),
        car(51, 30, 0, { kind: "tank" }),
        car(52, 60, 0, { kind: "tank" }),
        car(53, 90, 0),
      ],
    });
    sync.update(scene, FRAME_S, ORIGIN, view);
    expect(vehicles.map((fake) => fake.input!.turretYaw)).toEqual([
      2.2,
      -1,
      null,
      null,
    ]);
  });

  it("draws vehicles within 320 m and rebuilds one whose kind changed under its id", () => {
    const { sync, vehicles } = syncOf();
    const scene = sceneOf({
      vehicles: [
        car(50, VEHICLE_DRAW_DISTANCE_M - 1, 0),
        car(51, 0, VEHICLE_DRAW_DISTANCE_M + 1),
      ],
    });
    sync.update(scene, FRAME_S, ORIGIN, THIRD);
    expect(vehicles).toHaveLength(1);
    const bus = sceneOf({ vehicles: [car(50, 0, 0, { kind: "bus" })] });
    sync.update(bus, FRAME_S, ORIGIN, THIRD);
    expect(vehicles.map((fake) => fake.kind)).toEqual(["sedan", "bus"]);
    expect(vehicles[0]!.object.parent).toBeNull();
  });
});

describe("createEntitySync: pickups and disposal", () => {
  it("floats a pickup of its kind over its spot and tells it when it is taken", () => {
    const { sync, pickups } = syncOf();
    const taken = pickup(70, 4, 6, { kind: "health", takenAtTick: 250 });
    sync.update(sceneOf({ pickups: [taken] }), FRAME_S, ORIGIN, THIRD);
    expect(pickups[0]).toMatchObject({
      kind: "health",
      input: { taken: true, tick: TICK },
    });
    expect(pickups[0]!.object.position.toArray()).toEqual([4, 0, 6]);
    const back = sceneOf({ pickups: [{ ...taken, takenAtTick: null }] });
    sync.update(back, FRAME_S, ORIGIN, THIRD);
    expect(pickups[0]!.input!.taken).toBe(false);
    const far = pickup(71, CHARACTER_DRAW_DISTANCE_M + 1, 0);
    sync.update(sceneOf({ pickups: [far] }), FRAME_S, ORIGIN, THIRD);
    expect(pickups).toHaveLength(1);
  });

  it("disposes every character, vehicle and pickup, in use or released", () => {
    const { sync, characters, vehicles, pickups } = syncOf();
    sync.update(
      sceneOf({
        peds: [ped(20, 0, 0), ped(21, 1, 0)],
        vehicles: [car(50, 0, 0)],
        pickups: [pickup(70, 0, 0)],
      }),
      FRAME_S,
      ORIGIN,
      THIRD,
    );
    sync.update(sceneOf({ peds: [ped(20, 0, 0)] }), FRAME_S, ORIGIN, THIRD);
    sync.dispose();
    for (const fake of [...characters, ...vehicles, ...pickups])
      expect(fake.dispose).toHaveBeenCalledTimes(1);
    expect(sync.group.children).toHaveLength(0);
  });
});
