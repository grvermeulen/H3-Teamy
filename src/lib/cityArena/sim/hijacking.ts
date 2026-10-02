import type { Point } from "../world/projection";
import type { ArenaWorld } from "./arenaWorld";
import { MAX_PEDS } from "./limits";
import { PLAYER_RADIUS_M } from "./player";
import { playerById, replacePlayer } from "./players";
import type {
  ArenaPlayerState,
  ArenaState,
  VehicleBoarding,
  VehicleState,
} from "./types";
import { localToWorld, widthOf } from "./vehicle";

/** Fast traffic must slow before an on-foot player can reach its door. */
export const HIJACK_MAX_SPEED = 8;
/** Full occupied-car sequence, including closing the door. */
export const HIJACK_TICKS = 40;
/** Shorter entry sequence for an empty parked vehicle. */
export const PARKED_ENTRY_TICKS = 24;

/** Position beside a vehicle's front door, with per-kind width including buses and tractors. */
export function boardingDoor(vehicle: VehicleState, side: -1 | 1): Point {
  return localToWorld(vehicle, [
    vehicle.kind === "bus" ? 2.8 : 0.45,
    side * (widthOf(vehicle.kind) / 2 + 0.65),
  ]);
}

function clearDoor(
  vehicle: VehicleState,
  side: -1 | 1,
  world: ArenaWorld,
): boolean {
  const door = boardingDoor(vehicle, side);
  const resolved = world.collision.resolveCircle(door, PLAYER_RADIUS_M);
  return Math.hypot(door[0] - resolved[0], door[1] - resolved[1]) < 0.05;
}

/** Reserves an accessible vehicle; AI traffic keeps its controller until ejection. */
export function beginBoarding(
  state: ArenaState,
  player: ArenaPlayerState,
  vehicle: VehicleState,
  world: ArenaWorld,
): ArenaState {
  if (
    vehicle.boarding ||
    vehicle.wrecked ||
    state.players.some((entry) => entry.vehicleId === vehicle.id) ||
    Math.hypot(vehicle.velocityX, vehicle.velocityY) > HIJACK_MAX_SPEED
  )
    return state;
  const driver =
    state.traffic.find((entry) => entry.vehicleId === vehicle.id) ?? null;
  const left = boardingDoor(vehicle, -1);
  const right = boardingDoor(vehicle, 1);
  const side =
    driver ||
    Math.hypot(player.x - left[0], player.y - left[1]) <=
      Math.hypot(player.x - right[0], player.y - right[1])
      ? -1
      : 1;
  const door = side === -1 ? left : right;
  if (
    !clearDoor(vehicle, side, world) ||
    (driver &&
      (Math.hypot(player.x - door[0], player.y - door[1]) > 3 ||
        state.peds.length >= MAX_PEDS))
  )
    return state;
  const boarding: VehicleBoarding = {
    ownerId: player.id,
    startTick: state.tick,
    side,
    from: [player.x, player.y],
    driver,
    ejectedId: null,
  };
  return {
    ...state,
    vehicles: state.vehicles.map((entry) =>
      entry.id === vehicle.id ? { ...entry, boarding } : entry,
    ),
  };
}

/** Releases a reservation, restoring the AI only if its driver has not been thrown out. */
function cancelBoarding(state: ArenaState, vehicle: VehicleState): ArenaState {
  const boarding = vehicle.boarding!;
  const player = playerById(state, boarding.ownerId);
  let next = {
    ...state,
    vehicles: state.vehicles.map((entry) =>
      entry.id === vehicle.id ? { ...entry, boarding: undefined } : entry,
    ),
  };
  if (
    boarding.driver &&
    boarding.ejectedId === null &&
    !vehicle.wrecked &&
    !next.traffic.some((entry) => entry.vehicleId === vehicle.id)
  )
    next = { ...next, traffic: [...next.traffic, boarding.driver] };
  if (player?.vehicleId === vehicle.id) {
    const point = boardingDoor(vehicle, boarding.side);
    next = replacePlayer(next, {
      ...player,
      vehicleId: null,
      boardingTicksLeft: 0,
      x: point[0],
      y: point[1],
    });
  }
  return next;
}

/** Cancels in-flight boarding when the owner leaves, teleports or presses exit. */
export function cancelPlayerBoarding(
  state: ArenaState,
  playerId: number,
): ArenaState {
  const vehicle = state.vehicles.find(
    (entry) => entry.boarding?.ownerId === playerId,
  );
  return vehicle ? cancelBoarding(state, vehicle) : state;
}

/** Advances authoritative ejection and seat ownership after vehicle motion. */
export function stepBoarding(state: ArenaState, world: ArenaWorld): ArenaState {
  let next = state;
  for (const original of state.vehicles) {
    if (!original.boarding) continue;
    let vehicle = next.vehicles.find((entry) => entry.id === original.id)!;
    let boarding = vehicle.boarding!;
    let player = playerById(next, boarding.ownerId);
    const age = state.tick - boarding.startTick;
    const commit = boarding.driver ? 23 : 13;
    const finish = boarding.driver ? HIJACK_TICKS : PARKED_ENTRY_TICKS;
    if (
      !player ||
      player.diedAtTick !== null ||
      vehicle.wrecked ||
      !clearDoor(vehicle, boarding.side, world)
    ) {
      next = cancelBoarding(next, vehicle);
      continue;
    }
    const door = boardingDoor(vehicle, boarding.side);
    if (age === 6)
      next = {
        ...next,
        events: [
          ...next.events,
          {
            kind: "door",
            phase: "open",
            playerId: player.id,
            vehicleId: vehicle.id,
            x: vehicle.x,
            y: vehicle.y,
          },
        ],
      };
    if (boarding.driver && age >= 13 && boarding.ejectedId === null) {
      if (next.peds.length >= MAX_PEDS) {
        next = cancelBoarding(next, vehicle);
        continue;
      }
      const desired = localToWorld(vehicle, [
        0,
        boarding.side * (widthOf(vehicle.kind) / 2 + 2),
      ]);
      const landing = world.collision.resolveCircle(desired, PLAYER_RADIUS_M);
      if (Math.hypot(landing[0] - desired[0], landing[1] - desired[1]) > 0.5) {
        next = cancelBoarding(next, vehicle);
        continue;
      }
      const facing = vehicle.heading + (boarding.side * Math.PI) / 2;
      boarding = { ...boarding, ejectedId: next.nextId };
      vehicle = { ...vehicle, boarding };
      next = {
        ...next,
        nextId: next.nextId + 1,
        vehicles: next.vehicles.map((entry) =>
          entry.id === vehicle.id ? vehicle : entry,
        ),
        traffic: next.traffic.filter((entry) => entry.vehicleId !== vehicle.id),
        peds: [
          ...next.peds,
          {
            id: boarding.ejectedId!,
            x: landing[0],
            y: landing[1],
            facing,
            health: 100,
            mode: "flee",
            modeUntilTick: state.tick + 150,
            rail: null,
            fleeX: Math.cos(facing),
            fleeY: Math.sin(facing),
          },
        ],
        events: [
          ...next.events,
          {
            kind: "door",
            phase: "eject",
            playerId: player.id,
            vehicleId: vehicle.id,
            x: vehicle.x,
            y: vehicle.y,
          },
        ],
      };
    }
    if (age < commit) {
      const t = Math.min(1, age / 6);
      next = replacePlayer(next, {
        ...player,
        x: boarding.from[0] + (door[0] - boarding.from[0]) * t,
        y: boarding.from[1] + (door[1] - boarding.from[1]) * t,
        facing: vehicle.heading,
        speed: 0,
      });
    } else if (player.vehicleId !== vehicle.id) {
      player = {
        ...player,
        vehicleId: vehicle.id,
        boardingTicksLeft: Math.max(0, finish - age),
        x: vehicle.x,
        y: vehicle.y,
        speed: 0,
        driveSteer: 0,
      };
      next = replacePlayer(next, player);
      if (boarding.driver)
        next = {
          ...next,
          events: [
            ...next.events,
            {
              kind: "hijack",
              playerId: player.id,
              vehicleId: vehicle.id,
              x: vehicle.x,
              y: vehicle.y,
            },
          ],
        };
    } else {
      next = replacePlayer(next, {
        ...player,
        x: vehicle.x,
        y: vehicle.y,
        facing: vehicle.heading,
        speed: 0,
        boardingTicksLeft: Math.max(0, finish - age),
      });
    }
    if (age >= finish) {
      next = {
        ...next,
        vehicles: next.vehicles.map((entry) =>
          entry.id === vehicle.id ? { ...entry, boarding: undefined } : entry,
        ),
        events: [
          ...next.events,
          {
            kind: "door",
            phase: "close",
            playerId: player.id,
            vehicleId: vehicle.id,
            x: vehicle.x,
            y: vehicle.y,
          },
        ],
      };
    }
  }
  return next;
}

/** Pedestrians in their short throw animation wait before ordinary flee movement starts. */
export function driverIsLanding(state: ArenaState, pedId: number): boolean {
  return state.vehicles.some(
    (vehicle) =>
      vehicle.boarding?.ejectedId === pedId &&
      state.tick - vehicle.boarding.startTick < 23,
  );
}
