import { describe, expect, it, vi } from "vitest";
import type { Point } from "../world/projection";
import { lengthOf, widthOf } from "../sim/vehicle";
import { structureIdOf } from "../world/structureId";
import { createAimWorld, type AimScene } from "./aimWorld";
import { buildingHeight } from "./buildingMesh";
import { fixtureTown } from "./testing/cityFixture";
import { vehicleHeight } from "./vehicleModels";

/** The fixture town's house: a 10 m square at (20, 72), two storeys. */
const HOUSE = structureIdOf(1, 1, 0);
const AROUND_HOUSE = { minX: 18, minY: 70, maxX: 24, maxY: 74 };

/** A scene with you (player 1) and the given people and cars. */
function sceneOf(parts: Partial<AimScene> = {}): AimScene {
  return {
    localPlayerId: 1,
    players: [],
    peds: [],
    cops: [],
    vehicles: [],
    ...parts,
  } as AimScene;
}

/** A player at `(x, y)`, in car `vehicleId`, dead from `diedAtTick`. */
function player(
  id: number,
  x: number,
  vehicleId: number | null = null,
  diedAtTick: number | null = null,
) {
  return { id, x, y: 0, vehicleId, diedAtTick };
}

describe("createAimWorld", () => {
  it("lists everyone on foot: you as yourself, bodies as dead, players in a car left to its box", () => {
    const world = createAimWorld();
    world.sync(
      sceneOf({
        players: [player(1, 0), player(2, 5, null, 90), player(3, 9, 7)],
        peds: [
          { x: 12, y: 1, mode: "walk" },
          { x: 14, y: 2, mode: "dead" },
        ],
        cops: [{ x: 20, y: 3, diedAtTick: null }],
      } as unknown as Partial<AimScene>),
      [],
      [],
    );
    expect(world.characters).toEqual([
      { x: 0, y: 0, dead: false, self: true },
      { x: 5, y: 0, dead: true, self: false },
      { x: 12, y: 1, dead: false, self: false },
      { x: 14, y: 2, dead: true, self: false },
      { x: 20, y: 3, dead: false, self: false },
    ]);
  });

  it("sizes every vehicle by its kind and marks the one you drive as your own", () => {
    const world = createAimWorld();
    world.sync(
      sceneOf({
        players: [player(1, 0, 7)],
        vehicles: [
          { id: 7, kind: "sedan", x: 0, y: 0, heading: 1 },
          { id: 8, kind: "bus", x: 30, y: 4, heading: 2 },
        ],
      } as unknown as Partial<AimScene>),
      [],
      [],
    );
    expect(world.vehicles).toEqual([
      {
        x: 0,
        y: 0,
        heading: 1,
        length: lengthOf("sedan"),
        width: widthOf("sedan"),
        height: vehicleHeight("sedan"),
        own: true,
      },
      {
        x: 30,
        y: 4,
        heading: 2,
        length: lengthOf("bus"),
        width: widthOf("bus"),
        height: vehicleHeight("bus"),
        own: false,
      },
    ]);
  });

  it("hands out the standing buildings near an area with their height, and looks through fallen ones", () => {
    const world = createAimWorld();
    const town = fixtureTown();
    const visit = vi.fn<(ring: readonly Point[], height: number) => void>();
    world.sync(sceneOf(), [town], []);
    world.buildings.visit(AROUND_HOUSE, visit);
    // The house straddles two buckets, so it may come twice; nothing else comes at all.
    expect(visit).toHaveBeenCalled();
    for (const call of visit.mock.calls)
      expect(call).toEqual([town.buildings[0]!.ring, buildingHeight(2)]);
    visit.mockClear();
    world.sync(
      sceneOf(),
      [town],
      [{ id: HOUSE, damage: 900, destroyedAtTick: 40 }],
    );
    world.buildings.visit(AROUND_HOUSE, visit);
    expect(visit).not.toHaveBeenCalled();
  });

  it("keeps its entries from frame to frame", () => {
    const world = createAimWorld();
    const scene = sceneOf({
      players: [player(1, 0)],
      vehicles: [{ id: 8, kind: "sedan", x: 3, y: 0, heading: 0 }],
    } as unknown as Partial<AimScene>);
    world.sync(scene, [], []);
    const [you] = world.characters;
    const [car] = world.vehicles;
    world.sync(scene, [], []);
    expect(world.characters[0]).toBe(you);
    expect(world.vehicles[0]).toBe(car);
  });
});
