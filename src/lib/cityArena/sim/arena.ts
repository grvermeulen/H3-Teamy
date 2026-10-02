/**
 * The arena simulation's entry points: create a state, step it once, teleport the local player.
 * The stages themselves live in `boarding`, `movement`, `combat` and `roster`; this module is the
 * order they run in, and it re-exports the public surface those modules provide.
 */
import {
  localPlayer,
  orderedPlayers,
  playerById,
  replacePlayer,
} from "./players";
import type { MapIndex } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { withoutStructures } from "../world/collisionView";
import { findZone } from "../world/zone";
import { pruneEffects } from "./effects";
import { destroyedStructureIds, stepStructures } from "./structures";
import { applyPopulation, populateZone } from "./populate";
import { manageCops, stepCops } from "./cops";
import { stepPeds } from "./peds";
import { stepPickups } from "./pickups";
import { managePoliceCars } from "./police";
import {
  chooseSpawnNode,
  nearestZone,
  spawnParkedCars,
  spawnTanks,
} from "./spawn";
import { normalizeVehicles } from "./vehicle";
import { applyWanted } from "./wanted";
import { applyZoneRule } from "./zoneRule";
import { soberUp } from "./beer";
import { stepLandmarkBonuses } from "./landmarkVisits";
import { handleMissionInput, stepWorldMissions } from "../missions/world";
import { stepBoarding, cancelPlayerBoarding } from "./hijacking";
import { ensureMissionActors, stepMissionActors } from "../missions/actors";
import { EMPTY_INPUT } from "./types";
import type { ArenaInputs, ArenaState, WorldInput } from "./types";
import { applyEnterExit, applyWeaponSwitch, detectEdges } from "./boarding";
import { moveEntities } from "./movement";
import { advanceBullets, applyExplosions, applyFire } from "./combat";
import { applyRespawn, createArenaPlayer, ejectIfDead } from "./roster";
import {
  FIRST_ENTITY_ID,
  type ArenaSetup,
  type ArenaWorld,
} from "./arenaWorld";

export {
  BOARDING_TICKS,
  ENTER_RANGE_M,
  LOCAL_PLAYER_ID,
  type ArenaSetup,
  type ArenaWorld,
} from "./arenaWorld";
export { boardableVehicle, exitPosition, occupiedVehicle } from "./boarding";
export { addArenaPlayer, createArenaPlayer, removeArenaPlayer } from "./roster";

/** A fresh session: the player on a spawn node of `zone` (the map origin without one), parked cars in every zone and one tank per zone across from the spawn. */
export function createArenaState(
  setup: ArenaSetup,
  random: () => number,
): ArenaState {
  const spawn: Point = setup.zone
    ? chooseSpawnNode(setup.zone, [], random)
    : [0, 0];
  const parked = spawnParkedCars(
    setup.index,
    setup.graph,
    random,
    [spawn],
    FIRST_ENTITY_ID,
  );
  const tanks = spawnTanks(
    setup.index,
    setup.graph,
    [spawn],
    parked.map((car) => [car.x, car.y]),
    FIRST_ENTITY_ID + parked.length,
  );
  const vehicles = [...parked, ...tanks];
  const activeZone = setup.zone ?? nearestZone(setup.index, spawn);
  const base: ArenaState = {
    tick: 0,
    seed: setup.seed,
    nextId: FIRST_ENTITY_ID + vehicles.length,
    players: [createArenaPlayer(spawn, 0)],
    vehicles,
    bullets: [],
    effects: [],
    zoneKey: findZone(setup.index, spawn)?.key ?? null,
    peds: [],
    cops: [],
    pickups: [],
    traffic: [],
    events: [],
    activeZoneKey: null,
    enforcedZoneKey: null,
    zoneEnforced: false,
  };
  return activeZone
    ? populateZone(base, activeZone, setup.index, setup.graph, random)
    : base;
}

/**
 * The stages that belong to one player: their button edges, respawn, weapon switch and
 * boarding. Movement and firing run after these, once the cars have been stepped.
 */
function stepPlayerBefore(
  state: ArenaState,
  playerId: number,
  input: WorldInput,
  world: ArenaWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const player = playerById(state, playerId);
  if (!player) return state;
  const edges = detectEdges(player, input);
  let next = replacePlayer(state, { ...player, held: edges.held });
  const held = playerById(next, playerId);
  if (!held) return next;
  next = applyRespawn(next, held, world, tick, random);
  const respawned = playerById(next, playerId);
  if (!respawned) return next;
  const mission = handleMissionInput(
    next,
    respawned,
    input,
    edges.enterPressed,
    world.index,
  );
  if (mission.handled) return mission.state;
  next = applyWeaponSwitch(next, respawned, edges.weaponPressed);
  const switched = playerById(next, playerId);
  if (!switched) return next;
  return applyEnterExit(next, switched, edges.enterPressed, world);
}

/** One fixed step of the arena: the single simulation entry point. */
export function stepArena(
  state: ArenaState,
  inputs: ArenaInputs,
  dt: number,
  world: ArenaWorld,
  random: () => number,
): ArenaState {
  const paused =
    !state.zoneEnforced &&
    state.players.length === 1 &&
    Boolean(state.players[0].mission?.offer);
  const tick = state.tick + (paused ? 0 : 1);
  let next: ArenaState = { ...state, tick, events: [] };
  // A destroyed building is removed from collision for the whole tick through this view, built
  // once up front (spec §3.5): every stage below reads `live` instead of `world`, so cars drive
  // over rubble, people walk through the gap and bullets pass. The grid itself is never mutated.
  const live: ArenaWorld = {
    ...world,
    collision: withoutStructures(world.collision, destroyedStructureIds(state)),
  };
  if (!paused) {
    next = applyPopulation(next, live, tick, random);
    next = stepPickups(next, tick);
  }
  for (const player of orderedPlayers(next))
    next = stepPlayerBefore(
      next,
      player.id,
      inputs.get(player.id) ?? EMPTY_INPUT,
      live,
      tick,
      random,
    );
  if (paused) return next;
  next = ensureMissionActors(next, live);
  const worldInputs = new Map(
    [...inputs].map(([id, input]) => [
      id,
      next.players.find((player) => player.id === id)?.mission?.offer
        ? EMPTY_INPUT
        : input,
    ]),
  );
  next = moveEntities(next, worldInputs, dt, live, tick, random);
  next = stepBoarding(next, live);
  for (const player of orderedPlayers(next))
    next = applyFire(
      next,
      player,
      worldInputs.get(player.id) ?? EMPTY_INPUT,
      tick,
      random,
      live.collision,
    );
  next = stepCops(next, live, dt, tick, random);
  next = stepPeds(next, live, dt, tick, random);
  next = stepMissionActors(next, live, random);
  next = advanceBullets(next, dt, live, tick);
  next = applyExplosions(next, live, tick);
  next = stepStructures(next, tick);
  next = applyZoneRule(next, world.index, tick);
  next = soberUp(next);
  next = stepLandmarkBonuses(next);
  next = stepWorldMissions(next, state, inputs, world.index);
  next = applyWanted(next, tick);
  next = manageCops(next, live, tick, random);
  next = managePoliceCars(next, live, tick, random);
  for (const player of orderedPlayers(next))
    next = ejectIfDead(next, player, live);
  // zoneKey labels the HUD for whoever holds this state, so it follows the lowest-id player. An
  // empty roster is legal between a leave and the next join, and simply leaves the label alone.
  const anchor = orderedPlayers(next)[0];
  const zone = anchor ? findZone(world.index, [anchor.x, anchor.y]) : null;
  return {
    ...next,
    vehicles: normalizeVehicles(next.vehicles),
    effects: pruneEffects(next.effects, tick),
    zoneKey: anchor ? (zone?.key ?? null) : next.zoneKey,
  };
}

/** Moves the player instantly (zone picker), leaving any car and in-flight bullets behind. */
export function teleportArenaPlayer(
  state: ArenaState,
  position: Point,
  index: MapIndex,
): ArenaState {
  state = cancelPlayerBoarding(state, localPlayer(state).id);
  return {
    ...replacePlayer(state, {
      ...localPlayer(state),
      x: position[0],
      y: position[1],
      speed: 0,
      vehicleId: null,
      boardingTicksLeft: 0,
    }),
    bullets: [],
    zoneKey: findZone(index, position)?.key ?? null,
  };
}
