import { PLAYER_RADIUS_M } from "./player";
import type { ArenaPlayerState, VehicleState } from "./types";
import { RESTITUTION } from "./vehicle";

/** Radius of the single circle that stands in for a car in car–car and car–player contacts. */
export const CAR_BODY_RADIUS_M = 1.6;
/** Cars slower than this do not hurt people (spec §5). */
export const RUN_OVER_MIN_SPEED_MPS = 5;
/** Damage per m/s of car speed when running someone over (spec §5). */
export const RUN_OVER_DAMAGE_PER_MPS = 5;
/** Extra clearance a hit player is pushed to, so the next tick starts contact-free. */
export const RUN_OVER_CLEARANCE_M = 0.5;

/** One car–car contact this tick, by index into the vehicle list. */
export type PairImpact = { first: number; second: number; impactSpeed: number };

/** Both cars after a contact plus their approach speed. */
type PairResolution = {
  first: VehicleState;
  second: VehicleState;
  impactSpeed: number;
};

/** Separates two overlapping cars equally and exchanges their approach velocity with restitution. */
function resolvePair(
  first: VehicleState,
  second: VehicleState,
): PairResolution | null {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const distance = Math.hypot(dx, dy);
  const minimum = CAR_BODY_RADIUS_M * 2;
  if (distance >= minimum || distance === 0) return null;
  const normalX = dx / distance;
  const normalY = dy / distance;
  const shift = (minimum - distance) / 2;
  const approach =
    (first.velocityX - second.velocityX) * normalX +
    (first.velocityY - second.velocityY) * normalY;
  const impulse = approach > 0 ? ((1 + RESTITUTION) * approach) / 2 : 0;
  return {
    first: {
      ...first,
      x: first.x - normalX * shift,
      y: first.y - normalY * shift,
      velocityX: first.velocityX - normalX * impulse,
      velocityY: first.velocityY - normalY * impulse,
    },
    second: {
      ...second,
      x: second.x + normalX * shift,
      y: second.y + normalY * shift,
      velocityX: second.velocityX + normalX * impulse,
      velocityY: second.velocityY + normalY * impulse,
    },
    impactSpeed: Math.max(0, approach),
  };
}

/** Resolves every overlapping car pair once per tick (cars are few, so the pair loop is cheap). */
export function resolveVehiclePairs(vehicles: VehicleState[]): {
  vehicles: VehicleState[];
  impacts: PairImpact[];
} {
  const resolved = [...vehicles];
  const impacts: PairImpact[] = [];
  for (let first = 0; first < resolved.length; first++) {
    for (let second = first + 1; second < resolved.length; second++) {
      const pair = resolvePair(resolved[first], resolved[second]);
      if (!pair) continue;
      resolved[first] = pair.first;
      resolved[second] = pair.second;
      if (pair.impactSpeed > 0)
        impacts.push({ first, second, impactSpeed: pair.impactSpeed });
    }
  }
  return { vehicles: resolved, impacts };
}

/** Pushes a player on foot clear of a car and reports run-over damage (5 × speed above 5 m/s). */
export function resolveVehicleAgainstPlayer(
  vehicle: VehicleState,
  player: ArenaPlayerState,
): { player: ArenaPlayerState; damage: number } {
  const dx = player.x - vehicle.x;
  const dy = player.y - vehicle.y;
  const distance = Math.hypot(dx, dy);
  const minimum = CAR_BODY_RADIUS_M + PLAYER_RADIUS_M;
  if (distance >= minimum) return { player, damage: 0 };
  const normalX = distance === 0 ? 1 : dx / distance;
  const normalY = distance === 0 ? 0 : dy / distance;
  const clearance = minimum + RUN_OVER_CLEARANCE_M;
  const speed = Math.hypot(vehicle.velocityX, vehicle.velocityY);
  const damage =
    speed > RUN_OVER_MIN_SPEED_MPS ? RUN_OVER_DAMAGE_PER_MPS * speed : 0;
  return {
    player: {
      ...player,
      x: vehicle.x + normalX * clearance,
      y: vehicle.y + normalY * clearance,
    },
    damage,
  };
}
