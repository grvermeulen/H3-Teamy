import type { Point } from "../world/projection";
import type { ArenaPlayerState, VehicleState } from "./types";

/** Health at spawn (spec §5). */
export const PLAYER_MAX_HEALTH = 100;
/** Ticks between death and respawn (spec §5: 3 s). */
export const RESPAWN_DELAY_TICKS = 90;
/** Ticks of blinking invulnerability after a respawn (spec §5: 2 s). */
export const INVULNERABLE_TICKS = 60;
/** Blast radius of an exploding car (spec §5). */
export const EXPLOSION_RADIUS_M = 3;
/** Damage dealt inside the blast radius (spec §5). */
export const EXPLOSION_DAMAGE = 80;
/** Damage that certainly kills a full-health player (the occupant of an exploding car). */
export const LETHAL_DAMAGE = 1000;
/** Impact speeds up to this deal no damage (spec §5). */
export const IMPACT_DAMAGE_THRESHOLD_MPS = 4;
/** Damage per m/s of impact speed above the threshold (spec §5). */
export const IMPACT_DAMAGE_PER_MPS = 3;

/** Spec §5: max(0, impact speed − 4) × 3. */
export function impactDamage(impactSpeed: number): number {
  return (
    Math.max(0, impactSpeed - IMPACT_DAMAGE_THRESHOLD_MPS) *
    IMPACT_DAMAGE_PER_MPS
  );
}

/** True while the player waits for a respawn. */
export function isDead(player: Pick<ArenaPlayerState, "diedAtTick">): boolean {
  return player.diedAtTick !== null;
}

/** True while the post-respawn shield is active. */
export function isInvulnerable(
  player: Pick<ArenaPlayerState, "invulnerableUntilTick">,
  tick: number,
): boolean {
  return tick < player.invulnerableUntilTick;
}

/** Applies damage unless the player is dead or shielded; reaching 0 records the death tick. */
export function damagePlayer(
  player: ArenaPlayerState,
  amount: number,
  tick: number,
): ArenaPlayerState {
  if (amount <= 0 || isDead(player) || isInvulnerable(player, tick))
    return player;
  const health = Math.max(0, player.health - amount);
  return { ...player, health, diedAtTick: health === 0 ? tick : null };
}

/** Applies damage to a car, clamping at 0; wrecking (the explosion) is the arena step's job. */
export function damageVehicle(
  vehicle: VehicleState,
  amount: number,
): VehicleState {
  if (amount <= 0 || vehicle.wrecked) return vehicle;
  return { ...vehicle, health: Math.max(0, vehicle.health - amount) };
}

/** True when `point` lies inside the blast radius around the car. */
export function inBlastRadius(
  vehicle: Pick<VehicleState, "x" | "y">,
  point: Point,
): boolean {
  return (
    Math.hypot(point[0] - vehicle.x, point[1] - vehicle.y) < EXPLOSION_RADIUS_M
  );
}
