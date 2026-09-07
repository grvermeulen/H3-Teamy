import { MAX_BULLETS } from "./bullets";
import { COP_BODY_TICKS, COP_MAX_HEALTH } from "./cops";
import { PLAYER_MAX_HEALTH } from "./damage";
import { MAX_EFFECTS } from "./effects";
import {
  MAX_COPS,
  MAX_EVENTS,
  MAX_PEDS,
  MAX_PICKUPS,
  MAX_TRAFFIC,
  MAX_VEHICLES,
} from "./limits";
import type { ArenaState } from "./types";
import { VEHICLE_MAX_HEALTH } from "./vehicle";
import { PICKUP_RESPAWN_TICKS } from "./pickups";

/** Records `message` when `condition` is false. */
function check(
  violations: string[],
  condition: boolean,
  message: string,
): void {
  if (!condition) violations.push(message);
}

/** True when every value is a finite number. */
function finite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

/** Player health, ammo, position and car reference. */
function checkPlayer(state: ArenaState, violations: string[]): void {
  const { player } = state;
  check(
    violations,
    finite(player.x, player.y, player.facing, player.speed),
    "player position is not finite",
  );
  check(
    violations,
    player.health >= 0 && player.health <= PLAYER_MAX_HEALTH,
    `player.health ${player.health} out of range`,
  );
  check(
    violations,
    player.ammo.uzi >= 0 && player.ammo.shotgun >= 0,
    "player ammo negative",
  );
  check(
    violations,
    Number.isFinite(player.heat) && player.heat >= 0,
    "player heat negative or not finite",
  );
  check(
    violations,
    player.vehicleId === null ||
      state.vehicles.some(
        (vehicle) => vehicle.id === player.vehicleId && !vehicle.wrecked,
      ),
    "player.vehicleId points to a missing or wrecked car",
  );
  check(
    violations,
    player.diedAtTick === null ||
      (player.vehicleId === null && player.health === 0),
    "dead player must be on foot with zero health",
  );
  check(
    violations,
    player.diedAtTick === null || player.diedAtTick <= state.tick,
    "diedAtTick lies in the future",
  );
  check(
    violations,
    Number.isFinite(player.driveSteer) &&
      Math.abs(player.driveSteer) <= 1 &&
      (player.vehicleId !== null || player.driveSteer === 0),
    `player.driveSteer ${player.driveSteer} out of range or set on foot`,
  );
}

/** Car positions, health and unique ids. */
function checkVehicles(
  state: ArenaState,
  violations: string[],
  ids: Set<number>,
): void {
  check(violations, state.vehicles.length <= MAX_VEHICLES, "too many vehicles");
  for (const vehicle of state.vehicles) {
    check(
      violations,
      finite(
        vehicle.x,
        vehicle.y,
        vehicle.heading,
        vehicle.velocityX,
        vehicle.velocityY,
      ),
      `vehicle ${vehicle.id} is not finite`,
    );
    check(
      violations,
      vehicle.health >= 0 && vehicle.health <= VEHICLE_MAX_HEALTH,
      `vehicle ${vehicle.id} health out of range`,
    );
    check(
      violations,
      !ids.has(vehicle.id),
      `duplicate entity id ${vehicle.id}`,
    );
    ids.add(vehicle.id);
  }
}

/** Pedestrians and cops: caps, finite positions, death and health agreeing, bodies not overdue, and unique ids. */
function checkPeople(
  state: ArenaState,
  violations: string[],
  ids: Set<number>,
): void {
  check(violations, state.peds.length <= MAX_PEDS, "too many pedestrians");
  check(violations, state.cops.length <= MAX_COPS, "too many cops");
  for (const ped of state.peds) {
    check(
      violations,
      finite(ped.x, ped.y, ped.facing),
      `ped ${ped.id} is not finite`,
    );
    check(
      violations,
      (ped.mode === "dead") === (ped.health === 0),
      `ped ${ped.id} death and health disagree`,
    );
    check(
      violations,
      ped.mode !== "dead" || ped.modeUntilTick > state.tick,
      `ped ${ped.id} body expired`,
    );
    check(violations, !ids.has(ped.id), `duplicate entity id ${ped.id}`);
    ids.add(ped.id);
  }
  for (const cop of state.cops) {
    check(
      violations,
      finite(cop.x, cop.y, cop.facing),
      `cop ${cop.id} is not finite`,
    );
    check(
      violations,
      cop.health >= 0 && cop.health <= COP_MAX_HEALTH,
      `cop ${cop.id} health out of range`,
    );
    check(
      violations,
      (cop.diedAtTick !== null) === (cop.health === 0),
      `cop ${cop.id} death and health disagree`,
    );
    check(
      violations,
      cop.diedAtTick === null || cop.diedAtTick + COP_BODY_TICKS > state.tick,
      `cop ${cop.id} body expired`,
    );
    check(violations, !ids.has(cop.id), `duplicate entity id ${cop.id}`);
    ids.add(cop.id);
  }
}

/** Pickups, AI drivers and the per-tick event list. */
function checkPopulation(
  state: ArenaState,
  violations: string[],
  ids: Set<number>,
): void {
  check(violations, state.pickups.length <= MAX_PICKUPS, "too many pickups");
  check(violations, state.traffic.length <= MAX_TRAFFIC, "too many drivers");
  check(violations, state.events.length <= MAX_EVENTS, "too many events");
  for (const pickup of state.pickups) {
    check(
      violations,
      pickup.takenAtTick === null || pickup.takenAtTick <= state.tick,
      `pickup ${pickup.id} taken in the future`,
    );
    check(
      violations,
      pickup.takenAtTick === null ||
        state.tick - pickup.takenAtTick < PICKUP_RESPAWN_TICKS,
      `pickup ${pickup.id} overdue for its respawn`,
    );
    check(violations, !ids.has(pickup.id), `duplicate entity id ${pickup.id}`);
    ids.add(pickup.id);
  }
  const driven = new Set<number>();
  for (const driver of state.traffic) {
    const vehicle = state.vehicles.find(
      (candidate) => candidate.id === driver.vehicleId,
    );
    check(
      violations,
      vehicle !== undefined && !vehicle.wrecked,
      `driver of vehicle ${driver.vehicleId} has no intact car`,
    );
    check(
      violations,
      driver.role !== "police" ||
        vehicle === undefined ||
        vehicle.kind === "police",
      `driver of vehicle ${driver.vehicleId} is not in a police car`,
    );
    check(
      violations,
      !driven.has(driver.vehicleId) &&
        driver.vehicleId !== state.player.vehicleId,
      `vehicle ${driver.vehicleId} has more than one driver`,
    );
    driven.add(driver.vehicleId);
  }
}

/** Bullet and effect caps and expiry. */
function checkProjectiles(state: ArenaState, violations: string[]): void {
  check(violations, state.bullets.length <= MAX_BULLETS, "too many bullets");
  check(violations, state.effects.length <= MAX_EFFECTS, "too many effects");
  for (const bullet of state.bullets)
    check(
      violations,
      finite(bullet.x, bullet.y) && bullet.rangeLeftM > 0,
      `bullet ${bullet.id} expired or not finite`,
    );
  for (const effect of state.effects)
    check(
      violations,
      state.tick - effect.bornTick < effect.ttlTicks,
      `effect ${effect.id} expired`,
    );
}

/** Every broken invariant of a state (empty when healthy); pure, so tests run it after each step. */
export function checkInvariants(state: ArenaState): string[] {
  const violations: string[] = [];
  check(
    violations,
    Number.isInteger(state.tick) && state.tick >= 0,
    "tick must be a non-negative integer",
  );
  checkPlayer(state, violations);
  const ids = new Set<number>();
  checkVehicles(state, violations, ids);
  checkProjectiles(state, violations);
  checkPeople(state, violations, ids);
  checkPopulation(state, violations, ids);
  return violations;
}
