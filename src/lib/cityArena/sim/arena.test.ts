import { describe, expect, it } from "vitest";
import { createCollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import {
  BOARDING_TICKS,
  ENTER_RANGE_M,
  createArenaState,
  stepArena,
  teleportArenaPlayer,
  type ArenaWorld,
} from "./arena";
import { RESPAWN_DELAY_TICKS } from "./damage";
import { checkInvariants } from "./invariants";
import { createRng } from "./rng";
import {
  EMPTY_INPUT,
  createInput,
  type ArenaPlayerState,
  type ArenaState,
  type WorldInput,
} from "./types";
import { createVehicle, distanceToVehicle } from "./vehicle";

/** One zone with spawn nodes at 0, 100, 200 and 300 m along y = 0. */
const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [600, 0],
  radius: 2000,
  spawnNodes: [
    [0, 0],
    [400, 0],
    [800, 0],
    [1200, 0],
  ],
  landmarks: [],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [zone],
  landmarks: [],
};
const graph = decodeRoadGraph({
  nodes: [0, 0, 1200, 0],
  edges: [0, 1, 0, -1, 0, 1200],
  classes: ["residential"],
  names: [],
});
const world: ArenaWorld = { collision: createCollisionGrid(), index };
const step = 1 / 30;
const SPAWN_XS = [0, 100, 200, 300];

function boot(seed = 1): ArenaState {
  return createArenaState({ index, graph, seed, zone }, createRng(seed));
}

function run(
  state: ArenaState,
  input: WorldInput,
  ticks: number,
  random: () => number = createRng(99),
): ArenaState {
  let current = state;
  for (let index = 0; index < ticks; index++)
    current = stepArena(current, input, step, world, random);
  return current;
}

/** Replaces the parked cars by one compact `offsetX` metres east of the player. */
function withCar(
  state: ArenaState,
  offsetX: number,
  wrecked = false,
): ArenaState {
  const car = createVehicle(
    500,
    "compact",
    [state.player.x + offsetX, state.player.y],
    0,
    0,
  );
  return { ...state, vehicles: [{ ...car, wrecked }] };
}

/** Boards the nearby car, drives off, brakes and coasts to a full stop beside it (shared setup for the Uitstappen tests). */
function stoppedNextToCar(): ArenaState {
  const boarded = run(withCar(boot(), 3), createInput({ enter: true }), 1);
  const driven = run(boarded, createInput({ move: [0, -1] }), 60);
  const braked = run(driven, createInput({ move: [0, 1] }), 15);
  return run(braked, createInput({}), 30);
}

describe("createArenaState", () => {
  it("spawns the player on a spawn node with the loadout and parks cars away from them", () => {
    const state = boot();
    expect(state.tick).toBe(0);
    expect(state.seed).toBe(1);
    expect(state.zoneKey).toBe("campus");
    expect(state.player).toMatchObject({
      id: 0,
      health: 100,
      weapon: "pistol",
      ammo: { uzi: 60, shotgun: 8 },
      vehicleId: null,
      diedAtTick: null,
    });
    expect(SPAWN_XS).toContain(state.player.x);
    expect(state.vehicles.length).toBeGreaterThanOrEqual(1);
    expect(state.vehicles.length).toBeLessThanOrEqual(3);
    for (const car of state.vehicles)
      expect(Math.abs(car.x - state.player.x)).toBeGreaterThanOrEqual(8);
    expect(state.nextId).toBe(1 + state.vehicles.length);
    expect(boot(4)).toEqual(boot(4));
  });
});

describe("stepArena on foot", () => {
  it("advances the tick and walks with the aim as facing", () => {
    const start = boot();
    const walked = run(start, createInput({ move: [1, 0], aim: Math.PI }), 30);
    expect(walked.tick).toBe(30);
    expect(walked.player.x).toBeCloseTo(start.player.x + 4);
    expect(walked.player.facing).toBeCloseTo(Math.PI);
    expect(walked.held).toEqual({ enter: false, weaponNext: false });
  });

  it("cycles the weapon on a rising edge only", () => {
    const pressed = run(boot(), createInput({ weaponNext: true }), 5);
    expect(pressed.player.weapon).toBe("uzi");
    const released = run(pressed, createInput({}), 1);
    expect(
      run(released, createInput({ weaponNext: true }), 1).player.weapon,
    ).toBe("shotgun");
  });
});

describe("stepArena driving", () => {
  it("enters a car within 1.5 m on a rising edge, boards for 18 ticks, then drives with the car", () => {
    const near = withCar(boot(), 3);
    const boarded = run(near, createInput({ enter: true }), 1);
    expect(boarded.player.vehicleId).toBe(500);
    expect(boarded.player.boardingTicksLeft).toBe(BOARDING_TICKS - 1);
    const stillBoarding = run(
      boarded,
      createInput({ enter: true, move: [0, -1] }),
      17,
    );
    expect(stillBoarding.player.vehicleId).toBe(500);
    expect(stillBoarding.player.boardingTicksLeft).toBe(0);
    expect(stillBoarding.vehicles[0].x).toBeCloseTo(near.vehicles[0].x);
    const driving = run(stillBoarding, createInput({ move: [0, -1] }), 30);
    expect(driving.vehicles[0].velocityX).toBeCloseTo(6);
    expect(driving.vehicles[0].x).toBeCloseTo(near.vehicles[0].x + 3.1);
    expect(driving.player.x).toBeCloseTo(driving.vehicles[0].x);
    expect(driving.player.speed).toBeCloseTo(6);
  });

  it("steps out beside a stopped car on the next rising edge", () => {
    const stopped = stoppedNextToCar();
    expect(stopped.vehicles[0].velocityX).toBeCloseTo(0);
    const out = run(stopped, createInput({ enter: true }), 1);
    expect(out.player.vehicleId).toBeNull();
    expect(out.player.x).toBeCloseTo(stopped.vehicles[0].x);
    expect(out.player.y).toBeCloseTo(stopped.vehicles[0].y - 2.2);
    expect(out.player.speed).toBe(0);
  });

  it("leaves the player within Instappen reach after Uitstappen, unpushed next tick, and re-boardable", () => {
    const out = run(stoppedNextToCar(), createInput({ enter: true }), 1);
    const vehicle = out.vehicles[0];
    expect(
      distanceToVehicle(vehicle, [out.player.x, out.player.y]),
    ).toBeLessThan(ENTER_RANGE_M);
    const settled = run(out, EMPTY_INPUT, 1);
    expect(settled.player.x).toBeCloseTo(out.player.x);
    expect(settled.player.y).toBeCloseTo(out.player.y);
    const reboarded = run(settled, createInput({ enter: true }), 1);
    expect(reboarded.player.vehicleId).toBe(vehicle.id);
  });

  it("refuses cars out of reach and wrecks", () => {
    expect(
      run(withCar(boot(), 5), createInput({ enter: true }), 1).player.vehicleId,
    ).toBeNull();
    expect(
      run(withCar(boot(), 3, true), createInput({ enter: true }), 1).player
        .vehicleId,
    ).toBeNull();
  });

  it("teleports out of the car to the target and is deterministic for a seed", () => {
    const boarded = run(withCar(boot(), 3), createInput({ enter: true }), 1);
    const moved = teleportArenaPlayer(boarded, [150, 0], index);
    expect(moved.player).toMatchObject({
      x: 150,
      y: 0,
      vehicleId: null,
      speed: 0,
    });
    expect(moved.zoneKey).toBe("campus");
    const input = createInput({ move: [0.5, -0.5], enter: true });
    expect(run(boot(3), input, 60)).toEqual(run(boot(3), input, 60));
  });
});

describe("stepArena vehicle collision damage", () => {
  it("runs over the standing player above 5 m/s, scaling damage with speed and pushing them clear", () => {
    const state = boot();
    const runner = {
      ...createVehicle(
        600,
        "compact",
        [state.player.x + 2 / 3, state.player.y],
        0,
        0,
      ),
      velocityX: 10.1,
    };
    const hit = run({ ...state, vehicles: [runner] }, EMPTY_INPUT, 1);
    expect(hit.player.health).toBeCloseTo(50);
    expect(hit.player.x).toBeCloseTo(state.player.x - 1.5);
    expect(hit.player.y).toBeCloseTo(state.player.y);
    expect(hit.player.diedAtTick).toBeNull();
  });

  it("deals impactDamage to both cars in a head-on collision above the threshold", () => {
    const state = boot();
    const chasing = {
      ...createVehicle(701, "compact", [50, 50], 0, 0),
      velocityX: 8.1,
    };
    const parked = createVehicle(702, "compact", [52, 50], 0, 0);
    const crashed = run(
      { ...state, vehicles: [chasing, parked] },
      EMPTY_INPUT,
      1,
    );
    expect(crashed.vehicles[0].health).toBeCloseTo(88);
    expect(crashed.vehicles[1].health).toBeCloseTo(88);
  });
});

describe("stepArena firing and death", () => {
  it("fires the pistol on the trigger with a 12-tick cooldown and a muzzle flash", () => {
    const fired = run(boot(), createInput({ fire: true }), 1);
    expect(fired.bullets).toHaveLength(1);
    expect(fired.effects.map((effect) => effect.kind)).toEqual(["muzzle"]);
    expect(fired.player.nextShotTick).toBe(13);
    expect(
      run(boot(), createInput({ fire: true }), 13).player.nextShotTick,
    ).toBe(25);
  });

  it("spends Uzi rounds at 10 per second and shotgun shells five pellets at a time", () => {
    const uzi = run(boot(), createInput({ weaponNext: true, fire: true }), 30);
    expect(uzi.player.weapon).toBe("uzi");
    expect(uzi.player.ammo.uzi).toBe(50);
    const state = boot();
    const armed: ArenaPlayerState = { ...state.player, weapon: "shotgun" };
    const blast = run(
      { ...state, player: armed },
      createInput({ fire: true }),
      1,
    );
    expect(blast.bullets).toHaveLength(5);
    expect(blast.player.ammo.shotgun).toBe(7);
  });

  it("falls back to the pistol when a magazine runs dry", () => {
    const state = boot();
    const lastShell: ArenaPlayerState = {
      ...state.player,
      weapon: "shotgun",
      ammo: { uzi: 0, shotgun: 1 },
    };
    const fired = run(
      { ...state, player: lastShell },
      createInput({ fire: true }),
      1,
    );
    expect(fired.player.ammo.shotgun).toBe(0);
    expect(fired.player.weapon).toBe("pistol");
  });

  it("wrecks a car after 100 damage and only hurts a player inside the 3 m blast", () => {
    const state = boot();
    const shot = run(
      withCar(state, 6),
      createInput({ fire: true, aim: 0 }),
      49,
    );
    expect(shot.vehicles[0]).toMatchObject({ health: 0, wrecked: true });
    expect(shot.effects.map((effect) => effect.kind)).toContain("explosion");
    expect(shot.player.health).toBe(100);
    const fragile = {
      ...createVehicle(
        501,
        "compact",
        [state.player.x, state.player.y + 2.5],
        0,
        0,
      ),
      health: 20,
    };
    const blasted = run(
      { ...state, vehicles: [fragile] },
      createInput({ fire: true, aim: Math.PI / 2 }),
      1,
    );
    expect(blasted.vehicles[0].wrecked).toBe(true);
    expect(blasted.player.health).toBe(20);
    expect(blasted.player.diedAtTick).toBeNull();
  });

  it("kills the occupant of an exploding car, ejects the body and respawns after 90 ticks with a shield", () => {
    const state = boot();
    const seated = run(withCar(state, 3), createInput({ enter: true }), 1);
    const doomed = {
      ...seated,
      vehicles: [{ ...seated.vehicles[0], health: 0 }],
    };
    const dead = run(doomed, EMPTY_INPUT, 1);
    expect(dead.player).toMatchObject({
      health: 0,
      vehicleId: null,
      diedAtTick: 2,
    });
    expect(dead.vehicles[0].wrecked).toBe(true);
    const waiting = run(
      dead,
      createInput({ move: [1, 0], fire: true, enter: true }),
      88,
    );
    expect(waiting.player).toMatchObject({
      diedAtTick: 2,
      x: dead.player.x,
      vehicleId: null,
    });
    expect(waiting.bullets).toEqual([]);
    const alive = run(waiting, EMPTY_INPUT, 2);
    expect(alive.tick).toBe(92);
    expect(alive.player).toMatchObject({
      health: 100,
      diedAtTick: null,
      weapon: "pistol",
      invulnerableUntilTick: 152,
      ammo: { uzi: 60, shotgun: 8 },
    });
    expect(SPAWN_XS).toContain(alive.player.x);
  });

  it("shields a respawned player from the blast", () => {
    const state = boot();
    const shielded: ArenaPlayerState = {
      ...state.player,
      invulnerableUntilTick: 60,
    };
    const fragile = {
      ...createVehicle(
        501,
        "compact",
        [state.player.x, state.player.y + 2.5],
        0,
        0,
      ),
      health: 20,
    };
    const blasted = run(
      { ...state, player: shielded, vehicles: [fragile] },
      createInput({ fire: true, aim: Math.PI / 2 }),
      1,
    );
    expect(blasted.player.health).toBe(100);
  });

  it("keeps respawns off parked cars", () => {
    const state = boot();
    // Parked cars avoid the player's own spawn node (MIN_CAR_TO_PLAYER_M), so
    // booting already occupies the other three of the four spawn nodes.
    const freeX = state.player.x;
    expect(
      state.vehicles.map((vehicle) => vehicle.x).sort((a, b) => a - b),
    ).toEqual(SPAWN_XS.filter((x) => x !== freeX).sort((a, b) => a - b));

    const dying: ArenaState = {
      ...state,
      player: { ...state.player, health: 0, diedAtTick: state.tick },
    };
    const respawned = run(dying, EMPTY_INPUT, RESPAWN_DELAY_TICKS);
    expect(respawned.player.diedAtTick).toBeNull();
    expect(respawned.player.x).toBe(freeX);
    expect(respawned.player.y).toBe(0);
  });

  it("falls back to an unfiltered spawn node when every node is blocked", () => {
    const state = boot();
    const blockedEverywhere: ArenaState = {
      ...state,
      vehicles: SPAWN_XS.map((x, index) =>
        createVehicle(500 + index, "compact", [x, 0], 0, 0),
      ),
      player: { ...state.player, health: 0, diedAtTick: state.tick },
    };
    const respawned = run(blockedEverywhere, EMPTY_INPUT, RESPAWN_DELAY_TICKS);
    expect(respawned.player.diedAtTick).toBeNull();
    // Every node has a car on it, so the choice falls back to an unfiltered
    // node; collision resolution then immediately pushes the player off the
    // car's hull, so assert proximity to a known node rather than equality.
    const distanceToNearestNode = Math.min(
      ...SPAWN_XS.map((x) => Math.abs(respawned.player.x - x)),
    );
    expect(distanceToNearestNode).toBeLessThanOrEqual(3);
  });

  it("keeps the invariants across a busy run", () => {
    const busy = run(
      withCar(boot(), 3),
      createInput({
        move: [0.7, -0.7],
        fire: true,
        enter: true,
        weaponNext: true,
      }),
      200,
    );
    expect(checkInvariants(busy)).toEqual([]);
  });
});
