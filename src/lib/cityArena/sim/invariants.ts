import { MAX_BULLETS } from "./bullets";
import { PLAYER_MAX_HEALTH } from "./damage";
import { MAX_EFFECTS } from "./effects";
import type { ArenaState } from "./types";
import { VEHICLE_MAX_HEALTH } from "./vehicle";

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
}

/** Car positions, health and unique ids. */
function checkVehicles(state: ArenaState, violations: string[]): void {
  const ids = new Set<number>();
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
      `duplicate vehicle id ${vehicle.id}`,
    );
    ids.add(vehicle.id);
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
  checkVehicles(state, violations);
  checkProjectiles(state, violations);
  return violations;
}
