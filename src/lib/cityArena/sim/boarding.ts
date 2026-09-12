/**
 * Instappen and Uitstappen: who is in which car, where a player stands after stepping out, and the
 * edge-triggered buttons (Enter, weapon switch) that drive both. Combat and roster both throw a
 * player out of a car, so `exitVehicle` lives here rather than in either of them.
 */
import { driverPlayer, localPlayer, replacePlayer } from "./players";
import type { CollisionGrid } from "../world/collisionGrid";
import type { Point } from "../world/projection";
import { isDead } from "./damage";
import { PLAYER_RADIUS_M } from "./player";
import type {
  ArenaPlayerState,
  ArenaState,
  HeldButtons,
  VehicleState,
  WorldInput,
} from "./types";
import { distanceToVehicle, localToWorld } from "./vehicle";
import { nextWeapon } from "./weapons";
import { orderBeer } from "./beer";
import {
  BOARDING_TICKS,
  ENTER_RANGE_M,
  EXIT_OFFSET_M,
  type ArenaWorld,
} from "./arenaWorld";

/** Rising edges of `player`'s edge-triggered buttons plus the held state to remember. */
export function detectEdges(
  player: ArenaPlayerState,
  input: WorldInput,
): { enterPressed: boolean; weaponPressed: boolean; held: HeldButtons } {
  return {
    enterPressed: input.enter && !player.held.enter,
    weaponPressed: input.weaponNext && !player.held.weaponNext,
    held: { enter: input.enter, weaponNext: input.weaponNext },
  };
}

/** The car the player sits in, if any. */
export function occupiedVehicle(
  state: ArenaState,
  player: ArenaPlayerState = localPlayer(state),
): VehicleState | null {
  return (
    state.vehicles.find((vehicle) => vehicle.id === player.vehicleId) ?? null
  );
}

/**
 * The car an Instappen press would board: the nearest intact one whose body is within reach and
 * that nobody is already driving. The HUD reads it too, so what the button promises is what the
 * press does — at the brewery it decides between boarding and a beer.
 */
export function boardableVehicle(
  state: ArenaState,
  player: Pick<ArenaPlayerState, "x" | "y">,
): VehicleState | null {
  const at: Point = [player.x, player.y];
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
  return best !== null && driverPlayer(state, best.id) === null ? best : null;
}

/** Instappen: board the car {@link boardableVehicle} found, if any. */
function enterVehicle(state: ArenaState, player: ArenaPlayerState): ArenaState {
  const best = boardableVehicle(state, player);
  if (!best) return state;
  return replacePlayer(
    {
      ...state,
      traffic: state.traffic.filter((driver) => driver.vehicleId !== best.id),
    },
    {
      ...player,
      vehicleId: best.id,
      boardingTicksLeft: BOARDING_TICKS,
      x: best.x,
      y: best.y,
      facing: best.heading,
      speed: 0,
      driveSteer: 0,
    },
  );
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
export function exitVehicle(
  state: ArenaState,
  player: ArenaPlayerState,
  world: ArenaWorld,
): ArenaState {
  const vehicle = occupiedVehicle(state, player);
  const [x, y] = vehicle
    ? exitPosition(vehicle, world.collision)
    : [player.x, player.y];
  return replacePlayer(state, {
    ...player,
    vehicleId: null,
    boardingTicksLeft: 0,
    x,
    y,
    facing: vehicle ? vehicle.heading : player.facing,
    speed: 0,
    driveSteer: 0,
  });
}

/**
 * Handles the Instappen/Uitstappen edge for a living player. On foot the car wins; with no car
 * in reach the same press orders a beer when the player stands at the brewery's tap.
 */
export function applyEnterExit(
  state: ArenaState,
  player: ArenaPlayerState,
  pressed: boolean,
  world: ArenaWorld,
): ArenaState {
  if (!pressed || isDead(player)) return state;
  if (player.vehicleId !== null) return exitVehicle(state, player, world);
  const boarded = enterVehicle(state, player);
  return boarded === state ? orderBeer(state, player, world.index) : boarded;
}

/** Handles the Wapen edge. */
export function applyWeaponSwitch(
  state: ArenaState,
  player: ArenaPlayerState,
  pressed: boolean,
): ArenaState {
  if (!pressed || isDead(player)) return state;
  return replacePlayer(state, {
    ...player,
    weapon: nextWeapon(player.weapon, player.ammo),
  });
}
