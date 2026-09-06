import { PLAYER_RADIUS_M } from "./player";
import type { ArenaPlayerState, VehicleState } from "./types";
import { RESTITUTION } from "./vehicle";
import type { Point } from "../world/projection";

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
  if (distance >= minimum) return null;
  const normalX = distance === 0 ? 1 : dx / distance;
  const normalY = distance === 0 ? 0 : dy / distance;
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

/** Contact of a car with a person-sized circle: push-out point, damage and whether they touched. */
export type CircleContact = { point: Point; damage: number; touched: boolean };

/** Pushes a person-sized circle clear of a car and reports run-over damage. */
export function resolveVehicleAgainstCircle(
  vehicle: VehicleState,
  point: Point,
): CircleContact {
  const dx = point[0] - vehicle.x;
  const dy = point[1] - vehicle.y;
  const distance = Math.hypot(dx, dy);
  const minimum = CAR_BODY_RADIUS_M + PLAYER_RADIUS_M;
  if (distance >= minimum) return { point, damage: 0, touched: false };
  const normalX = distance === 0 ? 1 : dx / distance;
  const normalY = distance === 0 ? 0 : dy / distance;
  const speed = Math.hypot(vehicle.velocityX, vehicle.velocityY);
  const damage =
    speed > RUN_OVER_MIN_SPEED_MPS ? RUN_OVER_DAMAGE_PER_MPS * speed : 0;
  // A parked/slow car pushes the player to exactly `minimum` so the next tick starts
  // contact-free without oscillating; a moving car that hurt them gets the extra clearance.
  const clearance = damage > 0 ? minimum + RUN_OVER_CLEARANCE_M : minimum;
  return {
    point: [vehicle.x + normalX * clearance, vehicle.y + normalY * clearance],
    damage,
    touched: true,
  };
}

/** Pushes a player on foot clear of a car and reports run-over damage. */
export function resolveVehicleAgainstPlayer(
  vehicle: VehicleState,
  player: ArenaPlayerState,
): { player: ArenaPlayerState; damage: number } {
  const contact = resolveVehicleAgainstCircle(vehicle, [player.x, player.y]);
  if (!contact.touched) return { player, damage: 0 };
  return {
    player: { ...player, x: contact.point[0], y: contact.point[1] },
    damage: contact.damage,
  };
}
