import { PEDS_PER_ZONE } from "./peds";
import {
  driverPlayer,
  localPlayer,
  playerById,
  playersOf,
  replacePlayer,
} from "./players";
import { describe, expect, it } from "vitest";
import { createCollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import {
  BOARDING_TICKS,
  ENTER_RANGE_M,
  addArenaPlayer,
  createArenaState,
  removeArenaPlayer,
  stepArena,
  teleportArenaPlayer,
  type ArenaWorld,
} from "./arena";
import { MAX_BULLETS } from "./bullets";
import { MAX_ARENA_PLAYERS } from "./limits";
import { RESPAWN_DELAY_TICKS } from "./damage";
import { checkInvariants } from "./invariants";
import { POLICE_COLOUR, policeDrivers } from "./police";
import { createRng } from "./rng";
import {
  EMPTY_INPUT,
  createInput,
  type ArenaInputs,
  type ArenaPlayerState,
  type ArenaState,
  type BulletState,
  type DriverState,
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
const world: ArenaWorld = { collision: createCollisionGrid(), index, graph };
/** A tertiary road chain with nodes every 50 m, so police cars can route and spawn 60–120 m out. */
const chaseGraph = decodeRoadGraph({
  nodes: [0, 0, 200, 0, 400, 0, 600, 0, 800, 0, 1000, 0, 1200, 0],
  edges: [
    0, 1, 0, -1, 0, 200, 1, 2, 0, -1, 0, 200, 2, 3, 0, -1, 0, 200, 3, 4, 0, -1,
    0, 200, 4, 5, 0, -1, 0, 200, 5, 6, 0, -1, 0, 200,
  ],
  classes: ["tertiary"],
  names: [],
});
const chaseWorld: ArenaWorld = {
  collision: createCollisionGrid(),
  index,
  graph: chaseGraph,
  viewRect: { minX: 130, minY: -50, maxX: 170, maxY: 50 },
};
const step = 1 / 30;
const SPAWN_XS = [0, 100, 200, 300];
const FULL_AMMO = { uzi: 60, shotgun: 8, rifle: 0, bat: 0 };

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
    current = stepArena(
      current,
      new Map([[localPlayer(current).id, input]]),
      step,
      world,
      random,
    );
  return current;
}

/** Steps `state` on the police chase world. */
function runChase(
  state: ArenaState,
  input: WorldInput,
  ticks: number,
): ArenaState {
  const random = createRng(99);
  let current = state;
  for (let index = 0; index < ticks; index++)
    current = stepArena(
      current,
      new Map([[localPlayer(current).id, input]]),
      step,
      chaseWorld,
      random,
    );
  return current;
}

/** Steps a state while retaining the per-tick event batches. */
function runCollecting(
  state: ArenaState,
  input: WorldInput,
  ticks: number,
): { state: ArenaState; events: ArenaState["events"] } {
  const random = createRng(99);
  const events: ArenaState["events"] = [];
  let current = state;
  for (let index = 0; index < ticks; index++) {
    current = stepArena(
      current,
      new Map([[localPlayer(current).id, input]]),
      step,
      world,
      random,
    );
    events.push(...current.events);
  }
  return { state: current, events };
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
    [localPlayer(state).x + offsetX, localPlayer(state).y],
    0,
    0,
  );
  return { ...state, vehicles: [{ ...car, wrecked }] };
}

/** A live bullet far from the player and every zone, so it neither hits anything nor runs out of range within one tick. */
function makeBullet(id: number): BulletState {
  return {
    id,
    ownerId: -1,
    ignoreVehicleId: null,
    x: 50_000,
    y: 50_000,
    directionX: 1,
    directionY: 0,
    speedMps: 1,
    rangeLeftM: 1000,
    damage: 0,
    weapon: "pistol",
  };
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
    expect(localPlayer(state)).toMatchObject({
      id: 0,
      health: 100,
      weapon: "pistol",
      ammo: { uzi: 0, shotgun: 0, rifle: 0, bat: 0 },
      vehicleId: null,
      diedAtTick: null,
    });
    expect(localPlayer(state)).toMatchObject({
      heat: 0,
      outsideSinceTick: null,
    });
    expect(state).toMatchObject({
      cops: [],
      traffic: [],
      events: [],
      activeZoneKey: "campus",
      zoneEnforced: false,
    });
    expect(SPAWN_XS).toContain(localPlayer(state).x);
    expect(state.vehicles.length).toBeGreaterThanOrEqual(1);
    expect(state.vehicles.length).toBeLessThanOrEqual(30);
    for (const car of state.vehicles)
      expect(
        Math.hypot(car.x - localPlayer(state).x, car.y - localPlayer(state).y),
      ).toBeGreaterThanOrEqual(8);
    expect(state.pickups.map((pickup) => pickup.kind)).toEqual([
      "uzi",
      "shotgun",
      "rifle",
    ]);
    for (const pickup of state.pickups)
      expect(Math.abs(pickup.x - localPlayer(state).x)).toBeGreaterThanOrEqual(
        8,
      );
    expect(state.peds).toHaveLength(PEDS_PER_ZONE);
    for (const ped of state.peds) {
      expect(Math.abs(ped.y)).toBeCloseTo(4);
      expect(
        Math.hypot(ped.x - localPlayer(state).x, ped.y - localPlayer(state).y),
      ).toBeGreaterThanOrEqual(30);
    }
    expect(state.nextId).toBe(
      1 + state.vehicles.length + state.pickups.length + state.peds.length,
    );
    expect(boot(4)).toEqual(boot(4));
  });
});

/** The booted state plus a second player standing 20 m east of the first. */
function twoPlayers(state: ArenaState): ArenaState {
  const first = localPlayer(state);
  return {
    ...state,
    players: [first, { ...first, id: first.id + 1, x: first.x + 20 }],
  };
}

describe("joining and leaving", () => {
  it("spawns a joiner on a spawn node and refuses the ninth", () => {
    let state = boot();
    for (let index = 1; index < MAX_ARENA_PLAYERS; index += 1) {
      const joined = addArenaPlayer(state, world, 0, createRng(index));
      expect(joined.player).not.toBeNull();
      expect(SPAWN_XS).toContain(joined.player?.x);
      state = joined.state;
    }
    expect(playersOf(state)).toHaveLength(MAX_ARENA_PLAYERS);
    const full = addArenaPlayer(state, world, 0, createRng(99));
    expect(full.player).toBeNull();
    expect(full.state).toBe(state);
  });

  it("gives every joiner an id no live entity is using", () => {
    const first = addArenaPlayer(boot(), world, 0, createRng(2));
    const second = addArenaPlayer(first.state, world, 0, createRng(3));
    const ids = playersOf(second.state).map((player) => player.id);
    expect(new Set(ids).size).toBe(ids.length);
    const entityIds = second.state.vehicles.map((vehicle) => vehicle.id);
    expect(ids.some((id) => entityIds.includes(id))).toBe(false);
  });

  it("removes a player and leaves their car standing", () => {
    const joined = addArenaPlayer(boot(), world, 0, createRng(4));
    const joiner = joined.player;
    if (!joiner) throw new Error("the arena refused the joiner");
    const seated = replacePlayer(joined.state, {
      ...joiner,
      vehicleId: joined.state.vehicles[0].id,
    });
    const left = removeArenaPlayer(seated, joiner.id);
    expect(playerById(left, joiner.id)).toBeNull();
    expect(driverPlayer(left, seated.vehicles[0].id)).toBeNull();
    expect(left.vehicles).toHaveLength(seated.vehicles.length);
    expect(removeArenaPlayer(left, 999)).toBe(left);
  });
});

describe("stepArena with several players", () => {
  it("moves each player by their own input and nobody else's", () => {
    const start = twoPlayers(boot());
    const inputs: ArenaInputs = new Map([
      [0, createInput({ move: [1, 0] })],
      [1, EMPTY_INPUT],
    ]);
    const next = stepArena(start, inputs, step, world, createRng(99));
    expect(localPlayer(next).x).toBeGreaterThan(localPlayer(start).x);
    expect(playerById(next, 1)?.x).toBe(playerById(start, 1)?.x);
  });

  it("leaves a player without an input standing still", () => {
    const start = twoPlayers(boot());
    const next = stepArena(start, new Map(), step, world, createRng(99));
    expect(localPlayer(next).speed).toBe(0);
    expect(playerById(next, 1)?.speed).toBe(0);
  });

  it("gives each player their own button edges", () => {
    const start = twoPlayers(boot());
    const inputs: ArenaInputs = new Map([
      [0, createInput({ weaponNext: true })],
      [1, EMPTY_INPUT],
    ]);
    const next = stepArena(start, inputs, step, world, createRng(99));
    expect(localPlayer(next).held.weaponNext).toBe(true);
    expect(playerById(next, 1)?.held.weaponNext).toBe(false);
  });
});

describe("stepArena on foot", () => {
  it("advances the tick and walks with the aim as facing", () => {
    const start = boot();
    const walked = run(start, createInput({ move: [1, 0], aim: Math.PI }), 30);
    expect(walked.tick).toBe(30);
    expect(localPlayer(walked).x).toBeCloseTo(
      localPlayer(start).x + 5.174074,
      5,
    );
    expect(localPlayer(walked).facing).toBeCloseTo(Math.PI);
    expect(localPlayer(walked).held).toEqual({
      enter: false,
      weaponNext: false,
    });
  });

  it("remembers held buttons on the player, not on the world", () => {
    const held = run(boot(), createInput({ enter: true }), 1);
    expect(localPlayer(held).held).toEqual({ enter: true, weaponNext: false });
    const released = run(held, createInput({}), 1);
    expect(localPlayer(released).held).toEqual({
      enter: false,
      weaponNext: false,
    });
  });

  it("cycles the weapon on a rising edge only, skipping empty magazines", () => {
    const pressed = run(boot(), createInput({ weaponNext: true }), 5);
    expect(localPlayer(pressed).weapon).toBe("fist");
    const released = run(pressed, createInput({}), 1);
    const armed = run(
      { ...released, players: [{ ...localPlayer(released), ammo: FULL_AMMO }] },
      createInput({ weaponNext: true }),
      1,
    );
    expect(localPlayer(armed).weapon).toBe("pistol");
    const releasedAgain = run(armed, createInput({}), 1);
    expect(
      localPlayer(run(releasedAgain, createInput({ weaponNext: true }), 1))
        .weapon,
    ).toBe("uzi");
  });
});

describe("stepArena pickups", () => {
  it("takes a pickup and respawns it 600 ticks later", () => {
    const state = boot();
    const [pickup] = state.pickups;
    const beside: ArenaState = {
      ...state,
      players: [{ ...localPlayer(state), x: pickup.x + 0.5, y: pickup.y }],
    };
    const taken = run(beside, EMPTY_INPUT, 1);
    expect(localPlayer(taken).ammo.uzi).toBe(60);
    expect(localPlayer(taken).weapon).toBe("uzi");
    expect(taken.pickups[0].takenAtTick).toBe(1);
    expect(taken.events).toEqual([
      {
        kind: "pickup",
        pickupKind: "uzi",
        playerId: 0,
        x: pickup.x,
        y: pickup.y,
      },
    ]);
    const away: ArenaState = {
      ...taken,
      players: [{ ...localPlayer(taken), x: pickup.x + 50 }],
    };
    expect(run(away, EMPTY_INPUT, 599).pickups[0].takenAtTick).toBe(1);
    expect(run(away, EMPTY_INPUT, 600).pickups[0].takenAtTick).toBeNull();
  });
});

describe("stepArena driving", () => {
  it("enters a car within 1.5 m on a rising edge, boards for 18 ticks, then drives with the car", () => {
    const near = withCar(boot(), 3);
    const boarded = run(near, createInput({ enter: true }), 1);
    expect(localPlayer(boarded).vehicleId).toBe(500);
    expect(localPlayer(boarded).boardingTicksLeft).toBe(BOARDING_TICKS - 1);
    const stillBoarding = run(
      boarded,
      createInput({ enter: true, move: [0, -1] }),
      17,
    );
    expect(localPlayer(stillBoarding).vehicleId).toBe(500);
    expect(localPlayer(stillBoarding).boardingTicksLeft).toBe(0);
    expect(stillBoarding.vehicles[0].x).toBeCloseTo(near.vehicles[0].x);
    const driving = run(stillBoarding, createInput({ move: [0, -1] }), 30);
    expect(driving.vehicles[0].velocityX).toBeCloseTo(6);
    expect(driving.vehicles[0].x).toBeCloseTo(near.vehicles[0].x + 3.1);
    expect(localPlayer(driving).x).toBeCloseTo(driving.vehicles[0].x);
    expect(localPlayer(driving).speed).toBeCloseTo(6);
  });

  it("drives from an analog stick and re-centres the wheel on foot", () => {
    const boarded = run(withCar(boot(), 3), createInput({ enter: true }), 1);
    expect(localPlayer(boarded).driveSteer).toBe(0);
    expect(localPlayer(boarded).boardingTicksLeft).toBe(BOARDING_TICKS - 1);
    const ready = run(boarded, EMPTY_INPUT, BOARDING_TICKS - 1);
    expect(localPlayer(ready).boardingTicksLeft).toBe(0);
    // The car heads east; the stick points south, a 90° error asking for full
    // lock that the limiter releases at 6 / 30 = 0.2 per tick.
    const analog = createInput({ move: [0, 1], moveIsAnalog: true });
    expect(localPlayer(run(ready, analog, 1)).driveSteer).toBeCloseTo(0.2, 6);
    const turning = run(ready, analog, 5);
    expect(localPlayer(turning).driveSteer).toBeCloseTo(1, 6);
    expect(turning.vehicles[0].heading).toBeGreaterThan(0);
    const out = run(turning, createInput({ enter: true }), 1);
    expect(localPlayer(out).vehicleId).toBeNull();
    expect(localPlayer(out).driveSteer).toBe(0);
  });

  it("steps out beside a stopped car on the next rising edge", () => {
    const stopped = stoppedNextToCar();
    expect(stopped.vehicles[0].velocityX).toBeCloseTo(0);
    const out = run(stopped, createInput({ enter: true }), 1);
    expect(localPlayer(out).vehicleId).toBeNull();
    expect(localPlayer(out).x).toBeCloseTo(stopped.vehicles[0].x);
    expect(localPlayer(out).y).toBeCloseTo(stopped.vehicles[0].y - 2.2);
    expect(localPlayer(out).speed).toBe(0);
  });

  it("leaves the player within Instappen reach after Uitstappen, unpushed next tick, and re-boardable", () => {
    const out = run(stoppedNextToCar(), createInput({ enter: true }), 1);
    const vehicle = out.vehicles[0];
    expect(
      distanceToVehicle(vehicle, [localPlayer(out).x, localPlayer(out).y]),
    ).toBeLessThan(ENTER_RANGE_M);
    const settled = run(out, EMPTY_INPUT, 1);
    expect(localPlayer(settled).x).toBeCloseTo(localPlayer(out).x);
    expect(localPlayer(settled).y).toBeCloseTo(localPlayer(out).y);
    const reboarded = run(settled, createInput({ enter: true }), 1);
    expect(localPlayer(reboarded).vehicleId).toBe(vehicle.id);
  });

  it("refuses cars out of reach and wrecks", () => {
    expect(
      localPlayer(run(withCar(boot(), 5), createInput({ enter: true }), 1))
        .vehicleId,
    ).toBeNull();
    expect(
      localPlayer(
        run(withCar(boot(), 3, true), createInput({ enter: true }), 1),
      ).vehicleId,
    ).toBeNull();
  });

  it("teleports out of the car to the target and is deterministic for a seed", () => {
    const boarded = run(withCar(boot(), 3), createInput({ enter: true }), 1);
    const moved = teleportArenaPlayer(boarded, [150, 0], index);
    expect(localPlayer(moved)).toMatchObject({
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
        [localPlayer(state).x + 2 / 3, localPlayer(state).y],
        0,
        0,
      ),
      velocityX: 10.1,
    };
    const hit = run({ ...state, vehicles: [runner] }, EMPTY_INPUT, 1);
    expect(localPlayer(hit).health).toBeCloseTo(50);
    // Already inside the body, the nearer way out is the side, with the moving car's clearance.
    expect(localPlayer(hit).x).toBeCloseTo(localPlayer(state).x);
    expect(localPlayer(hit).y).toBeCloseTo(localPlayer(state).y + 1.8);
    expect(localPlayer(hit).diedAtTick).toBeNull();
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
    expect(localPlayer(fired).nextShotTick).toBe(13);
    expect(
      localPlayer(run(boot(), createInput({ fire: true }), 13)).nextShotTick,
    ).toBe(25);
  });

  it("spends Uzi rounds at 10 per second and shotgun shells five pellets at a time", () => {
    const state = boot();
    const withUzi: ArenaState = {
      ...state,
      players: [{ ...localPlayer(state), weapon: "uzi", ammo: FULL_AMMO }],
    };
    const uzi = run(withUzi, createInput({ fire: true }), 30);
    expect(localPlayer(uzi).weapon).toBe("uzi");
    expect(localPlayer(uzi).ammo.uzi).toBe(50);
    const armed: ArenaPlayerState = {
      ...localPlayer(state),
      weapon: "shotgun",
      ammo: FULL_AMMO,
    };
    const blast = run(
      { ...state, players: [armed] },
      createInput({ fire: true }),
      1,
    );
    expect(blast.bullets).toHaveLength(5);
    expect(localPlayer(blast).ammo.shotgun).toBe(7);
  });

  it("caps a shotgun pull at the live-bullet limit instead of overshooting it", () => {
    const state = boot();
    const armed: ArenaPlayerState = {
      ...localPlayer(state),
      weapon: "shotgun",
      ammo: FULL_AMMO,
    };
    const nearlyFull: ArenaState = {
      ...state,
      players: [armed],
      vehicles: [],
      bullets: Array.from({ length: MAX_BULLETS - 2 }, (_, index) =>
        makeBullet(900 + index),
      ),
    };
    const fired = run(nearlyFull, createInput({ fire: true, aim: 0 }), 1);
    expect(fired.bullets).toHaveLength(MAX_BULLETS);
    expect(localPlayer(fired).ammo.shotgun).toBe(7);
    expect(checkInvariants(fired)).toEqual([]);
  });

  it("falls back to the pistol when a magazine runs dry", () => {
    const state = boot();
    const lastShell: ArenaPlayerState = {
      ...localPlayer(state),
      weapon: "shotgun",
      ammo: { uzi: 0, shotgun: 1, rifle: 0, bat: 0 },
    };
    const fired = run(
      { ...state, players: [lastShell] },
      createInput({ fire: true }),
      1,
    );
    expect(localPlayer(fired).ammo.shotgun).toBe(0);
    expect(localPlayer(fired).weapon).toBe("pistol");
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
    expect(localPlayer(shot).health).toBe(100);
    const fragile = {
      ...createVehicle(
        501,
        "compact",
        [localPlayer(state).x, localPlayer(state).y + 2.5],
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
    expect(localPlayer(blasted).health).toBe(20);
    expect(localPlayer(blasted).diedAtTick).toBeNull();
  });

  it("kills the occupant of an exploding car, ejects the body and respawns after 90 ticks with a shield", () => {
    const state = boot();
    const seated = run(withCar(state, 3), createInput({ enter: true }), 1);
    const doomed = {
      ...seated,
      vehicles: [{ ...seated.vehicles[0], health: 0 }],
    };
    const dead = run(doomed, EMPTY_INPUT, 1);
    expect(localPlayer(dead)).toMatchObject({
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
    expect(localPlayer(waiting)).toMatchObject({
      diedAtTick: 2,
      x: localPlayer(dead).x,
      vehicleId: null,
    });
    expect(waiting.bullets).toEqual([]);
    const alive = run(waiting, EMPTY_INPUT, 2);
    expect(alive.tick).toBe(92);
    expect(localPlayer(alive)).toMatchObject({
      health: 100,
      diedAtTick: null,
      weapon: "pistol",
      invulnerableUntilTick: 152,
      ammo: { uzi: 0, shotgun: 0, rifle: 0, bat: 0 },
    });
    expect(SPAWN_XS).toContain(localPlayer(alive).x);
  });

  it("shields a respawned player from the blast", () => {
    const state = boot();
    const shielded: ArenaPlayerState = {
      ...localPlayer(state),
      invulnerableUntilTick: 60,
    };
    const fragile = {
      ...createVehicle(
        501,
        "compact",
        [localPlayer(state).x, localPlayer(state).y + 2.5],
        0,
        0,
      ),
      health: 20,
    };
    const blasted = run(
      { ...state, players: [shielded], vehicles: [fragile] },
      createInput({ fire: true, aim: Math.PI / 2 }),
      1,
    );
    expect(localPlayer(blasted).health).toBe(100);
  });

  it("keeps respawns off parked cars", () => {
    const state = boot();
    for (const vehicle of state.vehicles)
      expect(
        Math.hypot(
          vehicle.x - localPlayer(state).x,
          vehicle.y - localPlayer(state).y,
        ),
      ).toBeGreaterThanOrEqual(8);

    const dying: ArenaState = {
      ...state,
      players: [{ ...localPlayer(state), health: 0, diedAtTick: state.tick }],
    };
    const respawned = run(dying, EMPTY_INPUT, RESPAWN_DELAY_TICKS);
    expect(localPlayer(respawned).diedAtTick).toBeNull();
    expect(SPAWN_XS).toContain(localPlayer(respawned).x);
    expect(localPlayer(respawned).y).toBe(0);
    for (const vehicle of state.vehicles)
      expect(
        Math.hypot(
          vehicle.x - localPlayer(respawned).x,
          vehicle.y - localPlayer(respawned).y,
        ),
      ).toBeGreaterThanOrEqual(3.6);
  });

  it("falls back to an unfiltered spawn node when every node is blocked", () => {
    const state = boot();
    const blockedEverywhere: ArenaState = {
      ...state,
      vehicles: SPAWN_XS.map((x, index) =>
        createVehicle(500 + index, "compact", [x, 0], 0, 0),
      ),
      players: [{ ...localPlayer(state), health: 0, diedAtTick: state.tick }],
    };
    const respawned = run(blockedEverywhere, EMPTY_INPUT, RESPAWN_DELAY_TICKS);
    expect(localPlayer(respawned).diedAtTick).toBeNull();
    // Every node has a car on it, so the choice falls back to an unfiltered
    // node; collision resolution then immediately pushes the player off the
    // car's hull, so assert proximity to a known node rather than equality.
    const distanceToNearestNode = Math.min(
      ...SPAWN_XS.map((x) => Math.abs(localPlayer(respawned).x - x)),
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

  it("records one-tick shot and explosion events and resets heat on death", () => {
    const state = boot();
    const fired = run(state, createInput({ fire: true }), 1);
    expect(fired.events).toEqual([
      {
        kind: "shot",
        weapon: "pistol",
        ownerId: 0,
        x: localPlayer(state).x,
        y: localPlayer(state).y,
      },
    ]);
    expect(run(fired, createInput({ fire: true }), 1).events).toEqual([]);
    const fragile = {
      ...createVehicle(
        501,
        "compact",
        [localPlayer(state).x + 6, localPlayer(state).y],
        0,
        0,
      ),
      health: 20,
    };
    const boom = run(
      { ...state, vehicles: [fragile] },
      createInput({ fire: true, aim: 0 }),
      1,
    );
    expect(boom.events.map((event) => event.kind)).toEqual([
      "shot",
      "hit",
      "explosion",
    ]);
    const heated: ArenaState = {
      ...state,
      players: [
        { ...localPlayer(state), heat: 80, health: 0, diedAtTick: state.tick },
      ],
    };
    expect(
      localPlayer(run(heated, EMPTY_INPUT, RESPAWN_DELAY_TICKS)).heat,
    ).toBe(0);
  });
});

describe("stepArena police cars", () => {
  it("sends a police car after a two-star player and rams them", () => {
    const state = boot();
    const wanted: ArenaState = {
      ...state,
      vehicles: [],
      traffic: [],
      peds: [],
      players: [{ ...localPlayer(state), x: 240, y: 0, heat: 80, heatTick: 0 }],
    };
    const dispatched = runChase(wanted, EMPTY_INPUT, 1);
    const [driver] = policeDrivers(dispatched.traffic);
    expect(driver).toMatchObject({ role: "police", cruiseMps: 18 });
    const car = dispatched.vehicles.find(
      (vehicle) => vehicle.id === driver.vehicleId,
    );
    expect(car).toMatchObject({ kind: "police", colour: POLICE_COLOUR, y: 0 });
    expect(Math.abs((car?.x ?? 0) - 240)).toBe(60);
    const chased = runChase(wanted, EMPTY_INPUT, 150);
    const rammed =
      localPlayer(chased).health < 100 ||
      localPlayer(chased).diedAtTick !== null;
    expect(rammed).toBe(true);
    expect(checkInvariants(chased)).toEqual([]);
  });

  it("gives 20 heat for ramming a police car and hurts both cars", () => {
    const state = boot();
    const own = {
      ...createVehicle(
        600,
        "compact",
        [localPlayer(state).x, localPlayer(state).y],
        0,
        0,
      ),
      velocityX: 8,
    };
    const police = createVehicle(
      601,
      "police",
      [localPlayer(state).x + 3.5, localPlayer(state).y],
      Math.PI,
      POLICE_COLOUR,
    );
    const driver: DriverState = {
      vehicleId: 601,
      role: "police",
      cruiseMps: 18,
      fromNode: null,
      path: [],
      repathTick: 0,
    };
    const ramming: ArenaState = {
      ...state,
      vehicles: [own, police],
      traffic: [driver],
      peds: [],
      players: [
        {
          ...localPlayer(state),
          vehicleId: 600,
          boardingTicksLeft: 0,
          heat: 40,
          heatTick: 0,
        },
      ],
    };
    const { state: crashed, events } = runCollecting(ramming, EMPTY_INPUT, 3);
    expect(localPlayer(crashed).heat).toBe(60);
    // The heavier police car takes the smaller share of the same impact.
    expect(crashed.vehicles[0].health).toBeLessThan(crashed.vehicles[1].health);
    expect(crashed.vehicles[1].health).toBeLessThan(100);
    const impact = events.find((event) => event.kind === "impact");
    expect(impact).toMatchObject({ vehicleId: 600, otherVehicleId: 601 });
    // Contact registers a tick earlier through the hull circles than through the old body circle.
    if (impact?.kind === "impact") expect(impact.impactSpeed).toBeCloseTo(8.2);
  });

  it("escalates to two police cars and shotgun cops at three stars", () => {
    const state = boot();
    const hunted: ArenaState = {
      ...state,
      vehicles: [],
      traffic: [],
      peds: [],
      zoneEnforced: true,
      players: [
        { ...localPlayer(state), x: 200, y: 0, heat: 120, heatTick: 0 },
      ],
    };
    const escalated = runChase(hunted, EMPTY_INPUT, 2);
    expect(policeDrivers(escalated.traffic)).toHaveLength(2);
    expect(
      escalated.vehicles.filter((vehicle) => vehicle.kind === "police"),
    ).toHaveLength(2);
    expect(escalated.cops).toHaveLength(2);
    for (const cop of escalated.cops) expect(cop.weapon).toBe("shotgun");
    const busy = runChase(
      hunted,
      createInput({
        move: [0.7, -0.7],
        fire: true,
        enter: true,
        weaponNext: true,
      }),
      300,
    );
    expect(checkInvariants(busy)).toEqual([]);
  });

  it("releases police drivers and tows far cars once the heat is gone", () => {
    const state = boot();
    const police = createVehicle(
      601,
      "police",
      [localPlayer(state).x + 200, localPlayer(state).y],
      0,
      POLICE_COLOUR,
    );
    const driver: DriverState = {
      vehicleId: 601,
      role: "police",
      cruiseMps: 18,
      fromNode: null,
      path: [],
      repathTick: 0,
    };
    const calm: ArenaState = {
      ...state,
      vehicles: [police],
      traffic: [driver],
    };
    const released = run(calm, EMPTY_INPUT, 1);
    expect(released.traffic).toEqual([]);
    expect(released.vehicles).toEqual([]);
  });
});
