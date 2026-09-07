/**
 * One tick of motion: cars stepped from a single controls map keyed by vehicle, players walking or
 * riding, and the collision passes that follow. A player at the wheel overrides that car's AI
 * driver, which is why the controls map is built here rather than inside the traffic module.
 */
import { orderedPlayers, playerById, replacePlayer } from "./players";
import { driveStep, type DriveStep } from "./driveInput";
import { resolveVehicleAgainstPlayer, resolveVehiclePairs } from "./collisions";
import {
  IMPACT_DAMAGE_THRESHOLD_MPS,
  damagePlayer,
  damageVehicle,
  impactDamage,
  isDead,
} from "./damage";
import { pushEvent } from "./events";
import { policeChase } from "./police";
import { stepPlayer } from "./player";
import { stepDrivers } from "./traffic";
import { EMPTY_INPUT } from "./types";
import type {
  ArenaEvent,
  ArenaInputs,
  ArenaPlayerState,
  ArenaState,
  VehicleState,
  WorldInput,
} from "./types";
import {
  NO_CONTROLS,
  forwardSpeed,
  stepVehicle,
  type VehicleControls,
} from "./vehicle";
import { occupiedVehicle } from "./boarding";
import type { ArenaWorld } from "./arenaWorld";

/** Steps every car (only the occupied one gets controls), then applies building and car–car impact damage. */
function isAsleep(
  vehicle: VehicleState,
  controls: VehicleControls | undefined,
): boolean {
  return (
    controls === undefined && vehicle.velocityX === 0 && vehicle.velocityY === 0
  );
}

function withImpactEvent(
  events: ArenaEvent[],
  vehicleId: number,
  otherVehicleId: number | null,
  impactSpeed: number,
): ArenaEvent[] {
  if (impactSpeed <= IMPACT_DAMAGE_THRESHOLD_MPS) return events;
  return pushEvent(events, {
    kind: "impact",
    vehicleId,
    otherVehicleId,
    impactSpeed,
  });
}

type VehiclesStep = { vehicles: VehicleState[]; events: ArenaEvent[] };

function stepVehicles(
  state: ArenaState,
  dt: number,
  world: ArenaWorld,
  controlsByVehicle: Map<number, VehicleControls>,
): VehiclesStep {
  let events = state.events;
  const stepped = state.vehicles.map((vehicle) => {
    const controls = controlsByVehicle.get(vehicle.id);
    if (isAsleep(vehicle, controls)) return vehicle;
    const result = stepVehicle(
      vehicle,
      controls ?? NO_CONTROLS,
      dt,
      world.collision,
    );
    events = withImpactEvent(events, vehicle.id, null, result.impactSpeed);
    return damageVehicle(result.vehicle, impactDamage(result.impactSpeed));
  });
  const pairs = resolveVehiclePairs(stepped);
  const damaged = [...pairs.vehicles];
  for (const impact of pairs.impacts) {
    const amount = impactDamage(impact.impactSpeed);
    damaged[impact.first] = damageVehicle(damaged[impact.first], amount);
    damaged[impact.second] = damageVehicle(damaged[impact.second], amount);
    events = withImpactEvent(
      events,
      damaged[impact.first].id,
      damaged[impact.second].id,
      impact.impactSpeed,
    );
  }
  return { vehicles: damaged, events };
}

/** The driver follows the car while the boarding countdown runs out. */
function ridePlayer(
  player: ArenaPlayerState,
  vehicle: VehicleState,
  driveSteer: number,
): ArenaPlayerState {
  return {
    ...player,
    x: vehicle.x,
    y: vehicle.y,
    facing: vehicle.heading,
    speed: Math.abs(forwardSpeed(vehicle)),
    boardingTicksLeft: Math.max(0, player.boardingTicksLeft - 1),
    driveSteer,
  };
}

/** Walks a living player, then lets every car push (and, when fast, hurt) them. */
function walkPlayer(
  walker: ArenaPlayerState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  vehicles: VehicleState[],
  tick: number,
): ArenaPlayerState {
  let player = isDead(walker)
    ? walker
    : { ...walker, ...stepPlayer(walker, input, dt, world.collision) };
  for (const vehicle of vehicles) {
    const contact = resolveVehicleAgainstPlayer(vehicle, player);
    player = damagePlayer(contact.player, contact.damage, tick);
  }
  return player;
}

/** Moves the cars and the player for one tick. */
function driveOf(
  state: ArenaState,
  player: ArenaPlayerState,
  input: WorldInput,
  dt: number,
): DriveStep | null {
  const driving = occupiedVehicle(state, player);
  if (!driving || isDead(player) || player.boardingTicksLeft > 0) return null;
  return driveStep(input, driving.heading, player.driveSteer, dt);
}

/** The drive command of every player at the wheel this tick, keyed by player id. */
function playerDrives(
  state: ArenaState,
  inputs: ArenaInputs,
  dt: number,
): Map<number, DriveStep> {
  const drives = new Map<number, DriveStep>();
  for (const player of orderedPlayers(state)) {
    if (player.vehicleId === null) continue;
    const drive = driveOf(
      state,
      player,
      inputs.get(player.id) ?? EMPTY_INPUT,
      dt,
    );
    if (drive) drives.set(player.id, drive);
  }
  return drives;
}

/**
 * Moves the cars and every player for one tick. Cars step once, from a single map of controls:
 * each driving player's commands override the AI driver of the same car, so two players in two
 * cars steer independently and no car is stepped twice.
 */
export function moveEntities(
  state: ArenaState,
  inputs: ArenaInputs,
  dt: number,
  world: ArenaWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const drivers = stepDrivers(state, world, random, policeChase(state));
  const drives = playerDrives(state, inputs, dt);
  const controls = new Map(drivers.controls);
  for (const [playerId, drive] of drives) {
    const vehicleId = playerById(state, playerId)?.vehicleId;
    if (vehicleId !== null && vehicleId !== undefined)
      controls.set(vehicleId, drive.controls);
  }
  const moved = stepVehicles(state, dt, world, controls);
  let next: ArenaState = {
    ...state,
    traffic: drivers.traffic,
    vehicles: moved.vehicles,
    events: moved.events,
  };
  for (const player of orderedPlayers(state)) {
    const driving = occupiedVehicle(state, player);
    if (driving) {
      const ridden =
        moved.vehicles.find((vehicle) => vehicle.id === driving.id) ?? driving;
      const steer = drives.get(player.id)?.steer ?? 0;
      next = replacePlayer(next, ridePlayer(player, ridden, steer));
      continue;
    }
    const walker = playerById(next, player.id);
    if (!walker) continue;
    next = replacePlayer(
      next,
      walkPlayer(
        walker,
        inputs.get(player.id) ?? EMPTY_INPUT,
        dt,
        world,
        moved.vehicles,
        tick,
      ),
    );
  }
  return next;
}
