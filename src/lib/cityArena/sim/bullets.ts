import type { CollisionGrid } from "../world/collisionGrid";
import type { Point } from "../world/projection";
import { firstBuildingHit } from "../world/raycast";
import { PLAYER_RADIUS_M } from "./player";
import type { BulletState, VehicleState, WeaponKind } from "./types";
import { VEHICLE_LENGTH_M, VEHICLE_WIDTH_M, worldToLocal } from "./vehicle";
import type { WeaponSpec } from "./weapons";

/** Hard cap on live bullets (checked by the invariants). */
export const MAX_BULLETS = 64;

/** Who fires: the owner (never hit by its own bullets), the car it sits in (ignored by its bullets) and the first free id. */
export type ShotSource = {
  ownerId: number;
  ignoreVehicleId: number | null;
  firstId: number;
};

/** A player as a bullet target. */
export type PlayerTarget = { id: number; x: number; y: number };

/** What a bullet can hit. */
export type BulletTarget =
  | { kind: "building" }
  | { kind: "vehicle"; vehicleId: number }
  | { kind: "player"; playerId: number };

/** One bullet impact this tick. */
export type BulletHit = {
  bullet: BulletState;
  point: Point;
  target: BulletTarget;
};

/** What the bullet step reads from the world. */
export type BulletWorld = {
  collision: Pick<CollisionGrid, "query">;
  vehicles: VehicleState[];
  players: PlayerTarget[];
};

/** Creates the pellets of one trigger pull, each jittered uniformly inside the weapon's cone. */
export function createShots(
  spec: WeaponSpec,
  weapon: WeaponKind,
  origin: Point,
  angle: number,
  source: ShotSource,
  random: () => number,
): BulletState[] {
  const shots: BulletState[] = [];
  for (let pellet = 0; pellet < spec.pellets; pellet++) {
    const jitter =
      spec.spreadRad === 0 ? 0 : (random() * 2 - 1) * spec.spreadRad;
    const direction = angle + jitter;
    shots.push({
      id: source.firstId + pellet,
      ownerId: source.ownerId,
      ignoreVehicleId: source.ignoreVehicleId,
      x: origin[0],
      y: origin[1],
      directionX: Math.cos(direction),
      directionY: Math.sin(direction),
      speedMps: spec.speedMps,
      rangeLeftM: spec.rangeM,
      damage: spec.damage,
      weapon,
    });
  }
  return shots;
}

/** Parameter t in [0, 1] along from→to where the segment first enters a circle (0 when it starts inside), or `null`. */
export function segmentHitsCircle(
  from: Point,
  to: Point,
  centre: Point,
  radius: number,
): number | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const fx = from[0] - centre[0];
  const fy = from[1] - centre[1];
  const c = fx * fx + fy * fy - radius * radius;
  if (c < 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** Parameter t in [0, 1] where from→to enters the car body (slab test in the car frame), or `null`. */
export function segmentHitsVehicle(
  from: Point,
  to: Point,
  vehicle: VehicleState,
): number | null {
  const start = worldToLocal(vehicle, from);
  const end = worldToLocal(vehicle, to);
  const halfExtents: Point = [VEHICLE_LENGTH_M / 2, VEHICLE_WIDTH_M / 2];
  const axes: (0 | 1)[] = [0, 1];
  let entry = 0;
  let exit = 1;
  for (const axis of axes) {
    const delta = end[axis] - start[axis];
    if (delta === 0) {
      if (Math.abs(start[axis]) > halfExtents[axis]) return null;
      continue;
    }
    const near = (-halfExtents[axis] - start[axis]) / delta;
    const far = (halfExtents[axis] - start[axis]) / delta;
    entry = Math.max(entry, Math.min(near, far));
    exit = Math.min(exit, Math.max(near, far));
    if (entry > exit) return null;
  }
  return entry;
}

/** A possible hit along the sweep. */
type Candidate = { t: number; target: BulletTarget };

/** Cars the sweep enters, except the shooter's own. */
function vehicleCandidates(
  bullet: BulletState,
  from: Point,
  to: Point,
  vehicles: VehicleState[],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const vehicle of vehicles) {
    if (vehicle.id === bullet.ignoreVehicleId) continue;
    const t = segmentHitsVehicle(from, to, vehicle);
    if (t !== null)
      candidates.push({
        t,
        target: { kind: "vehicle", vehicleId: vehicle.id },
      });
  }
  return candidates;
}

/** Players the sweep enters, except the shooter. */
function playerCandidates(
  bullet: BulletState,
  from: Point,
  to: Point,
  players: PlayerTarget[],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const player of players) {
    if (player.id === bullet.ownerId) continue;
    const t = segmentHitsCircle(
      from,
      to,
      [player.x, player.y],
      PLAYER_RADIUS_M,
    );
    if (t !== null)
      candidates.push({ t, target: { kind: "player", playerId: player.id } });
  }
  return candidates;
}

/** The candidate closest to the sweep start. */
function nearestCandidate(candidates: Candidate[]): Candidate | null {
  return candidates.reduce<Candidate | null>(
    (best, candidate) =>
      best === null || candidate.t < best.t ? candidate : best,
    null,
  );
}

/** The bullet's sweep this tick, clipped to its remaining range. */
function sweep(
  bullet: BulletState,
  dt: number,
): { to: Point; travelled: number } {
  const travelled = Math.min(bullet.speedMps * dt, bullet.rangeLeftM);
  return {
    to: [
      bullet.x + bullet.directionX * travelled,
      bullet.y + bullet.directionY * travelled,
    ],
    travelled,
  };
}

/** Resolves one bullet for this tick: the survivor (or `null`) and the hit (or `null`). */
function resolveBullet(
  bullet: BulletState,
  dt: number,
  world: BulletWorld,
): { bullet: BulletState | null; hit: BulletHit | null } {
  const from: Point = [bullet.x, bullet.y];
  const { to, travelled } = sweep(bullet, dt);
  const building = firstBuildingHit(world.collision, from, to);
  const buildingT =
    building && travelled > 0
      ? Math.hypot(building[0] - from[0], building[1] - from[1]) / travelled
      : null;
  const entity = nearestCandidate([
    ...vehicleCandidates(bullet, from, to, world.vehicles),
    ...playerCandidates(bullet, from, to, world.players),
  ]);
  if (entity && (buildingT === null || entity.t <= buildingT)) {
    const point: Point = [
      from[0] + (to[0] - from[0]) * entity.t,
      from[1] + (to[1] - from[1]) * entity.t,
    ];
    return { bullet: null, hit: { bullet, point, target: entity.target } };
  }
  if (building)
    return {
      bullet: null,
      hit: { bullet, point: building, target: { kind: "building" } },
    };
  const rangeLeftM = bullet.rangeLeftM - travelled;
  if (rangeLeftM <= 0) return { bullet: null, hit: null };
  return { bullet: { ...bullet, x: to[0], y: to[1], rangeLeftM }, hit: null };
}

/** Sweeps every bullet by `dt`; bullets that hit something or run out of range are dropped. */
export function stepBullets(
  bullets: BulletState[],
  dt: number,
  world: BulletWorld,
): { bullets: BulletState[]; hits: BulletHit[] } {
  const survivors: BulletState[] = [];
  const hits: BulletHit[] = [];
  for (const bullet of bullets) {
    const result = resolveBullet(bullet, dt, world);
    if (result.bullet) survivors.push(result.bullet);
    if (result.hit) hits.push(result.hit);
  }
  return { bullets: survivors, hits };
}
