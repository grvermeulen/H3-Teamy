import type { CollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { findZone, findZoneByKey } from "../world/zone";
import {
  MAX_BULLETS,
  createShots,
  stepBullets,
  type BulletHit,
} from "./bullets";
import {
  CAR_BODY_RADIUS_M,
  RUN_OVER_CLEARANCE_M,
  resolveVehicleAgainstPlayer,
  resolveVehiclePairs,
} from "./collisions";
import {
  EXPLOSION_DAMAGE,
  INVULNERABLE_TICKS,
  LETHAL_DAMAGE,
  PLAYER_MAX_HEALTH,
  RESPAWN_DELAY_TICKS,
  damagePlayer,
  damageVehicle,
  impactDamage,
  inBlastRadius,
  isDead,
} from "./damage";
import { addEffect, pruneEffects } from "./effects";
import { PLAYER_RADIUS_M, stepPlayer } from "./player";
import {
  chooseSpawnNode,
  nearestZone,
  spawnParkedCars,
  type SpawnGraph,
} from "./spawn";
import type {
  ArenaPlayerState,
  ArenaState,
  BulletState,
  EffectState,
  HeldButtons,
  VehicleState,
  WorldInput,
} from "./types";
import {
  NO_CONTROLS,
  distanceToVehicle,
  forwardSpeed,
  localToWorld,
  stepVehicle,
  type VehicleControls,
} from "./vehicle";
import {
  SPAWN_AMMO,
  WEAPONS,
  consumeAmmo,
  cooldownTicks,
  hasAmmo,
  nextWeapon,
} from "./weapons";

/** Distance from the car body within which Instappen works (spec §5). */
export const ENTER_RANGE_M = 1.5;
/** Ticks the driver needs to get in before the car answers the controls (spec §5: 0.6 s). */
export const BOARDING_TICKS = 18;
/** The local player's id; Plan 3 assigns real ids. */
export const LOCAL_PLAYER_ID = 0;
/** First id handed to entities (the player is 0). */
const FIRST_ENTITY_ID = 1;
/** How far from the car centre a player stands after Uitstappen: just outside the car–player contact circle. */
const EXIT_OFFSET_M =
  CAR_BODY_RADIUS_M + PLAYER_RADIUS_M + RUN_OVER_CLEARANCE_M;

/** What the arena step reads from the world. */
export type ArenaWorld = {
  collision: Pick<CollisionGrid, "resolveCircle" | "query">;
  index: MapIndex;
};

/** What a session is created from. */
export type ArenaSetup = {
  index: MapIndex;
  graph: SpawnGraph;
  seed: number;
  zone: MapZone | null;
};

/** A player standing at `position` with the spawn loadout, ready to fire from `tick`. */
export function createArenaPlayer(
  position: Point,
  tick: number,
): ArenaPlayerState {
  return {
    id: LOCAL_PLAYER_ID,
    x: position[0],
    y: position[1],
    facing: -Math.PI / 2,
    speed: 0,
    health: PLAYER_MAX_HEALTH,
    weapon: "pistol",
    ammo: SPAWN_AMMO,
    vehicleId: null,
    boardingTicksLeft: 0,
    nextShotTick: tick,
    diedAtTick: null,
    invulnerableUntilTick: tick,
  };
}

/** A fresh session: the player on a spawn node of `zone` (the map origin without one) and parked cars in every zone. */
export function createArenaState(
  setup: ArenaSetup,
  random: () => number,
): ArenaState {
  const spawn: Point = setup.zone
    ? chooseSpawnNode(setup.zone, [], random)
    : [0, 0];
  const vehicles = spawnParkedCars(
    setup.index,
    setup.graph,
    random,
    [spawn],
    FIRST_ENTITY_ID,
  );
  return {
    tick: 0,
    seed: setup.seed,
    nextId: FIRST_ENTITY_ID + vehicles.length,
    player: createArenaPlayer(spawn, 0),
    vehicles,
    bullets: [],
    effects: [],
    held: { enter: false, weaponNext: false },
    zoneKey: findZone(setup.index, spawn)?.key ?? null,
  };
}

/** Rising edges of the edge-triggered buttons plus the held state to remember. */
function detectEdges(
  held: HeldButtons,
  input: WorldInput,
): { enterPressed: boolean; weaponPressed: boolean; held: HeldButtons } {
  return {
    enterPressed: input.enter && !held.enter,
    weaponPressed: input.weaponNext && !held.weaponNext,
    held: { enter: input.enter, weaponNext: input.weaponNext },
  };
}

/** The car the player sits in, if any. */
export function occupiedVehicle(state: ArenaState): VehicleState | null {
  return (
    state.vehicles.find((vehicle) => vehicle.id === state.player.vehicleId) ??
    null
  );
}

/** Instappen: board the nearest intact car whose body is within reach. */
function enterVehicle(state: ArenaState): ArenaState {
  const at: Point = [state.player.x, state.player.y];
  let best: VehicleState | null = null;
  let bestDistance = ENTER_RANGE_M;
  for (const vehicle of state.vehicles) {
    if (vehicle.wrecked) continue;
    const distance = distanceToVehicle(vehicle, at);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = vehicle;
    }
  }
  if (!best) return state;
  return {
    ...state,
    player: {
      ...state.player,
      vehicleId: best.id,
      boardingTicksLeft: BOARDING_TICKS,
      x: best.x,
      y: best.y,
      facing: best.heading,
      speed: 0,
    },
  };
}

/** Where a player stands after leaving a car: beside the driver's door, pushed out of walls. */
export function exitPosition(
  vehicle: VehicleState,
  collision: Pick<CollisionGrid, "resolveCircle">,
): Point {
  const beside = localToWorld(vehicle, [0, -EXIT_OFFSET_M]);
  return collision.resolveCircle(beside, PLAYER_RADIUS_M);
}

/** Uitstappen (also used when the driver dies): the player steps out beside the car. */
function exitVehicle(state: ArenaState, world: ArenaWorld): ArenaState {
  const vehicle = occupiedVehicle(state);
  const [x, y] = vehicle
    ? exitPosition(vehicle, world.collision)
    : [state.player.x, state.player.y];
  return {
    ...state,
    player: {
      ...state.player,
      vehicleId: null,
      boardingTicksLeft: 0,
      x,
      y,
      facing: vehicle ? vehicle.heading : state.player.facing,
      speed: 0,
    },
  };
}

/** Handles the Instappen/Uitstappen edge for a living player. */
function applyEnterExit(
  state: ArenaState,
  pressed: boolean,
  world: ArenaWorld,
): ArenaState {
  if (!pressed || isDead(state.player)) return state;
  return state.player.vehicleId === null
    ? enterVehicle(state)
    : exitVehicle(state, world);
}

/** Handles the Wapen edge. */
function applyWeaponSwitch(state: ArenaState, pressed: boolean): ArenaState {
  if (!pressed || isDead(state.player)) return state;
  const weapon = nextWeapon(state.player.weapon, state.player.ammo);
  return { ...state, player: { ...state.player, weapon } };
}

/** Stick or keys to car controls: up is gas, down is brake/reverse, x steers. */
function controlsFromInput(input: WorldInput): VehicleControls {
  return { throttle: -input.move[1], steer: input.move[0] };
}

/** Steps every car (only the occupied one gets controls), then applies building and car–car impact damage. */
function stepVehicles(
  state: ArenaState,
  controls: VehicleControls,
  dt: number,
  world: ArenaWorld,
): VehicleState[] {
  const stepped = state.vehicles.map((vehicle) => {
    const own = vehicle.id === state.player.vehicleId ? controls : NO_CONTROLS;
    const result = stepVehicle(vehicle, own, dt, world.collision);
    return damageVehicle(result.vehicle, impactDamage(result.impactSpeed));
  });
  const pairs = resolveVehiclePairs(stepped);
  const damaged = [...pairs.vehicles];
  for (const impact of pairs.impacts) {
    const amount = impactDamage(impact.impactSpeed);
    damaged[impact.first] = damageVehicle(damaged[impact.first], amount);
    damaged[impact.second] = damageVehicle(damaged[impact.second], amount);
  }
  return damaged;
}

/** The driver follows the car while the boarding countdown runs out. */
function ridePlayer(
  player: ArenaPlayerState,
  vehicle: VehicleState,
): ArenaPlayerState {
  return {
    ...player,
    x: vehicle.x,
    y: vehicle.y,
    facing: vehicle.heading,
    speed: Math.abs(forwardSpeed(vehicle)),
    boardingTicksLeft: Math.max(0, player.boardingTicksLeft - 1),
  };
}

/** Walks a living player, then lets every car push (and, when fast, hurt) them. */
function walkPlayer(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  vehicles: VehicleState[],
  tick: number,
): ArenaPlayerState {
  let player = isDead(state.player)
    ? state.player
    : {
        ...state.player,
        ...stepPlayer(state.player, input, dt, world.collision),
      };
  for (const vehicle of vehicles) {
    const contact = resolveVehicleAgainstPlayer(vehicle, player);
    player = damagePlayer(contact.player, contact.damage, tick);
  }
  return player;
}

/** Moves the cars and the player for one tick. */
function moveEntities(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  const driving = occupiedVehicle(state);
  const canDrive =
    driving !== null &&
    !isDead(state.player) &&
    state.player.boardingTicksLeft === 0;
  const controls = canDrive ? controlsFromInput(input) : NO_CONTROLS;
  const vehicles = stepVehicles(state, controls, dt, world);
  if (driving) {
    const ridden =
      vehicles.find((vehicle) => vehicle.id === driving.id) ?? driving;
    return { ...state, vehicles, player: ridePlayer(state.player, ridden) };
  }
  return {
    ...state,
    vehicles,
    player: walkPlayer(state, input, dt, world, vehicles, tick),
  };
}

/** Ammo, weapon and cooldown after one trigger pull; an emptied magazine falls back to the pistol. */
function afterShot(player: ArenaPlayerState, tick: number): ArenaPlayerState {
  const ammo = consumeAmmo(player.ammo, player.weapon);
  return {
    ...player,
    ammo,
    weapon: hasAmmo(ammo, player.weapon) ? player.weapon : "pistol",
    nextShotTick: tick + cooldownTicks(player.weapon),
  };
}

/** True when the trigger can fire this tick: alive, cooldown elapsed, ammo left and under the bullet cap. */
function canFire(state: ArenaState, input: WorldInput, tick: number): boolean {
  const { player } = state;
  return (
    input.fire &&
    !isDead(player) &&
    tick >= player.nextShotTick &&
    hasAmmo(player.ammo, player.weapon) &&
    state.bullets.length < MAX_BULLETS
  );
}

/** The pellets, effects list and next free id produced by one trigger pull. */
type FireResult = {
  shots: BulletState[];
  effects: EffectState[];
  nextId: number;
};

/** Creates the pellets of one trigger pull and, for anything but the fist, its muzzle flash. */
function fireShots(
  state: ArenaState,
  angle: number,
  tick: number,
  random: () => number,
): FireResult {
  const { player } = state;
  const shots = createShots(
    WEAPONS[player.weapon],
    player.weapon,
    [player.x, player.y],
    angle,
    {
      ownerId: player.id,
      ignoreVehicleId: player.vehicleId,
      firstId: state.nextId,
    },
    random,
  );
  const muzzleId = state.nextId + shots.length;
  const effects =
    player.weapon === "fist"
      ? state.effects
      : addEffect(state.effects, {
          id: muzzleId,
          kind: "muzzle",
          x: player.x,
          y: player.y,
          angle,
          bornTick: tick,
        });
  return { shots, effects, nextId: muzzleId + 1 };
}

/** Fires while the trigger is held, the cooldown has passed and there is ammo; drive-bys fire from the car and ignore it. */
function applyFire(
  state: ArenaState,
  input: WorldInput,
  tick: number,
  random: () => number,
): ArenaState {
  if (!canFire(state, input, tick)) return state;
  const angle = input.aim ?? state.player.facing;
  const { shots, effects, nextId } = fireShots(state, angle, tick, random);
  return {
    ...state,
    nextId,
    bullets: [...state.bullets, ...shots],
    effects,
    player: afterShot(state.player, tick),
  };
}

/** Applies one bullet hit: car damage, or damage to a player on foot (never the shooter). */
function applyHit(state: ArenaState, hit: BulletHit, tick: number): ArenaState {
  if (hit.target.kind === "vehicle") {
    const vehicleId = hit.target.vehicleId;
    return {
      ...state,
      vehicles: state.vehicles.map((vehicle) =>
        vehicle.id === vehicleId
          ? damageVehicle(vehicle, hit.bullet.damage)
          : vehicle,
      ),
    };
  }
  if (hit.target.kind === "player" && hit.target.playerId === state.player.id)
    return {
      ...state,
      player: damagePlayer(state.player, hit.bullet.damage, tick),
    };
  return state;
}

/** Sweeps the bullets, applies their hits and spawns an impact effect per hit. */
function advanceBullets(
  state: ArenaState,
  dt: number,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  const { player } = state;
  const onFoot = !isDead(player) && player.vehicleId === null;
  const swept = stepBullets(state.bullets, dt, {
    collision: world.collision,
    vehicles: state.vehicles,
    players: onFoot ? [{ id: player.id, x: player.x, y: player.y }] : [],
  });
  let next: ArenaState = { ...state, bullets: swept.bullets };
  for (const hit of swept.hits) {
    const struck = applyHit(next, hit, tick);
    next = {
      ...struck,
      nextId: struck.nextId + 1,
      effects: addEffect(struck.effects, {
        id: struck.nextId,
        kind: "impact",
        x: hit.point[0],
        y: hit.point[1],
        angle: 0,
        bornTick: tick,
      }),
    };
  }
  return next;
}

/** Blast damage to the player: lethal for the occupant, 80 inside the radius on foot. */
function blastPlayer(
  player: ArenaPlayerState,
  vehicle: VehicleState,
  tick: number,
): ArenaPlayerState {
  if (player.vehicleId === vehicle.id)
    return damagePlayer(player, LETHAL_DAMAGE, tick);
  if (player.vehicleId === null && inBlastRadius(vehicle, [player.x, player.y]))
    return damagePlayer(player, EXPLOSION_DAMAGE, tick);
  return player;
}

/** Wrecks one car that reached 0 health: explosion effect, blast damage to the player and to cars nearby. */
function explodeVehicle(
  state: ArenaState,
  vehicle: VehicleState,
  tick: number,
): ArenaState {
  const vehicles = state.vehicles.map((other) => {
    if (other.id === vehicle.id)
      return { ...other, wrecked: true, velocityX: 0, velocityY: 0 };
    return inBlastRadius(vehicle, [other.x, other.y])
      ? damageVehicle(other, EXPLOSION_DAMAGE)
      : other;
  });
  return {
    ...state,
    vehicles,
    nextId: state.nextId + 1,
    player: blastPlayer(state.player, vehicle, tick),
    effects: addEffect(state.effects, {
      id: state.nextId,
      kind: "explosion",
      x: vehicle.x,
      y: vehicle.y,
      angle: 0,
      bornTick: tick,
    }),
  };
}

/** Explodes every car whose health reached 0 this tick and throws its occupant out. */
function applyExplosions(
  state: ArenaState,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  let next = state;
  for (const vehicle of state.vehicles) {
    if (vehicle.health > 0 || vehicle.wrecked) continue;
    next = explodeVehicle(next, vehicle, tick);
    if (next.player.vehicleId === vehicle.id) next = exitVehicle(next, world);
  }
  return next;
}

/** Safety net: a player who died while seated is placed beside the car. */
function ejectIfDead(state: ArenaState, world: ArenaWorld): ArenaState {
  if (!isDead(state.player) || state.player.vehicleId === null) return state;
  return exitVehicle(state, world);
}

/** After 90 ticks: full health and the spawn loadout on a node of the current (else nearest) zone, shielded for 60 ticks. */
function applyRespawn(
  state: ArenaState,
  world: ArenaWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const { player } = state;
  if (
    player.diedAtTick === null ||
    tick < player.diedAtTick + RESPAWN_DELAY_TICKS
  )
    return state;
  const zone =
    (state.zoneKey ? findZoneByKey(world.index, state.zoneKey) : null) ??
    nearestZone(world.index, [player.x, player.y]);
  const spawn: Point = zone
    ? chooseSpawnNode(zone, [], random)
    : [player.x, player.y];
  return {
    ...state,
    player: {
      ...createArenaPlayer(spawn, tick),
      invulnerableUntilTick: tick + INVULNERABLE_TICKS,
    },
  };
}

/** One fixed step of the arena: the single simulation entry point. */
export function stepArena(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  random: () => number,
): ArenaState {
  const tick = state.tick + 1;
  const edges = detectEdges(state.held, input);
  let next: ArenaState = { ...state, tick, held: edges.held };
  next = applyRespawn(next, world, tick, random);
  next = applyWeaponSwitch(next, edges.weaponPressed);
  next = applyEnterExit(next, edges.enterPressed, world);
  next = moveEntities(next, input, dt, world, tick);
  next = applyFire(next, input, tick, random);
  next = advanceBullets(next, dt, world, tick);
  next = applyExplosions(next, world, tick);
  next = ejectIfDead(next, world);
  const zone = findZone(world.index, [next.player.x, next.player.y]);
  return {
    ...next,
    effects: pruneEffects(next.effects, tick),
    zoneKey: zone?.key ?? null,
  };
}

/** Moves the player instantly (zone picker), leaving any car and in-flight bullets behind. */
export function teleportArenaPlayer(
  state: ArenaState,
  position: Point,
  index: MapIndex,
): ArenaState {
  return {
    ...state,
    player: {
      ...state.player,
      x: position[0],
      y: position[1],
      speed: 0,
      vehicleId: null,
      boardingTicksLeft: 0,
    },
    bullets: [],
    zoneKey: findZone(index, position)?.key ?? null,
  };
}
