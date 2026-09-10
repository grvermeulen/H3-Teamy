import { PLAYER_RADIUS_M } from "./player";
import type { ArenaPlayerState, VehicleState } from "./types";
import {
  RESTITUTION,
  hullCircles,
  hullLayout,
  lengthOf,
  localToWorld,
  massOf,
  widthOf,
  worldToLocal,
} from "./vehicle";
import type { Point } from "../world/projection";

/**
 * Radius of the circle that stood in for every car before the hulls took over contacts; still the
 * clearance the traffic AI, the spawns and the exit keep around one.
 */
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

/** The contact between two cars: the normal from the first to the second and how deep they overlap. */
type HullContact = { normalX: number; normalY: number; overlap: number };

/** Cars further apart than their reaches cannot touch: the cheap reject before the circle loop. */
function beyondReach(first: VehicleState, second: VehicleState): boolean {
  const reach =
    (lengthOf(first.kind) +
      widthOf(first.kind) +
      lengthOf(second.kind) +
      widthOf(second.kind)) /
    2;
  return Math.hypot(second.x - first.x, second.y - first.y) >= reach;
}

/**
 * The contact between two cars, if any. The normal runs centre to centre; the overlap is how far
 * along it the deepest pair of touching hull circles has to be pulled apart, which also handles a
 * pair that has crossed (a circle already behind the other car's) without pushing the wrong way.
 */
function hullContact(
  first: VehicleState,
  second: VehicleState,
): HullContact | null {
  if (beyondReach(first, second)) return null;
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const distance = Math.hypot(dx, dy);
  const normalX = distance === 0 ? 1 : dx / distance;
  const normalY = distance === 0 ? 0 : dy / distance;
  const minimum =
    hullLayout(first.kind).radiusM + hullLayout(second.kind).radiusM;
  let overlap = 0;
  for (const a of hullCircles(first))
    for (const b of hullCircles(second)) {
      const gapX = b[0] - a[0];
      const gapY = b[1] - a[1];
      if (Math.hypot(gapX, gapY) >= minimum) continue;
      overlap = Math.max(overlap, minimum - (gapX * normalX + gapY * normalY));
    }
  return overlap > 0 ? { normalX, normalY, overlap } : null;
}

/**
 * Separates two overlapping cars — the lighter one moves more — and exchanges their approach
 * velocity with restitution, again by mass: a bus shoves a compact, not the reverse.
 */
function resolvePair(
  first: VehicleState,
  second: VehicleState,
): PairResolution | null {
  const contact = hullContact(first, second);
  if (!contact) return null;
  const { normalX, normalY, overlap } = contact;
  const total = massOf(first.kind) + massOf(second.kind);
  const firstShare = massOf(second.kind) / total;
  const secondShare = massOf(first.kind) / total;
  const approach =
    (first.velocityX - second.velocityX) * normalX +
    (first.velocityY - second.velocityY) * normalY;
  const impulse = approach > 0 ? (1 + RESTITUTION) * approach : 0;
  return {
    first: {
      ...first,
      x: first.x - normalX * overlap * firstShare,
      y: first.y - normalY * overlap * firstShare,
      velocityX: first.velocityX - normalX * impulse * firstShare,
      velocityY: first.velocityY - normalY * impulse * firstShare,
    },
    second: {
      ...second,
      x: second.x + normalX * overlap * secondShare,
      y: second.y + normalY * overlap * secondShare,
      velocityX: second.velocityX + normalX * impulse * secondShare,
      velocityY: second.velocityY + normalY * impulse * secondShare,
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

/**
 * Pushes a person-sized circle clear of a car's body and reports run-over damage. The body is the
 * kind's rectangle grown by the person's radius, and the way out is through the nearer face, so
 * someone clipped at the side steps aside and someone hit head-on is carried in front — and
 * nobody is ever pushed the length of a bus.
 */
export function resolveVehicleAgainstCircle(
  vehicle: VehicleState,
  point: Point,
): CircleContact {
  const [forward, right] = worldToLocal(vehicle, point);
  const halfLength = lengthOf(vehicle.kind) / 2 + PLAYER_RADIUS_M;
  const halfWidth = widthOf(vehicle.kind) / 2 + PLAYER_RADIUS_M;
  if (Math.abs(forward) >= halfLength || Math.abs(right) >= halfWidth)
    return { point, damage: 0, touched: false };
  const speed = Math.hypot(vehicle.velocityX, vehicle.velocityY);
  const damage =
    speed > RUN_OVER_MIN_SPEED_MPS ? RUN_OVER_DAMAGE_PER_MPS * speed : 0;
  // A parked/slow car pushes the person to exactly the face so the next tick starts contact-free
  // without oscillating; a moving car that hurt them gets the extra clearance.
  const clearance = damage > 0 ? RUN_OVER_CLEARANCE_M : 0;
  const forwardEscape = halfLength - Math.abs(forward);
  const rightEscape = halfWidth - Math.abs(right);
  const local: Point =
    forwardEscape < rightEscape
      ? [Math.sign(forward || 1) * (halfLength + clearance), right]
      : [forward, Math.sign(right || 1) * (halfWidth + clearance)];
  return { point: localToWorld(vehicle, local), damage, touched: true };
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
