/**
 * What lies under the crosshair (aim spec §5). Each frame a ray from the city camera through the
 * screen centre is tested against the characters (upright capsules), the vehicles (boxes turned
 * to their heading), the buildings (footprint prisms up to their height) and the ground; the
 * nearest hit within reach is the aim point, else the point at reach along the ray — the sky.
 * Scalar maths on reused scratch, so a probe allocates nothing.
 */
import type { PerspectiveCamera } from "three";
import type { Rect } from "../mapBuild/geometry";
import type { Point } from "../world/projection";

/** What the crosshair covers. */
export type AimTarget = "character" | "vehicle" | "building" | "ground" | "sky";

/** The aim point: world metres, its height, and its distance along the ray from the camera. */
export type AimPoint = {
  x: number;
  y: number;
  height: number;
  distance: number;
  target: AimTarget;
};

/** A person the ray may meet; `self` (the local player) is looked through. */
export type AimCharacter = {
  x: number;
  y: number;
  dead: boolean;
  self: boolean;
};

/** A vehicle the ray may meet: `length` runs along `heading`; `own` (your car) is looked through. */
export type AimVehicle = {
  x: number;
  y: number;
  heading: number;
  length: number;
  width: number;
  height: number;
  own: boolean;
};

/** Called with a building's footprint, world metres, and how high it stands. */
export type AimBuildingVisitor = (
  ring: readonly Point[],
  height: number,
) => void;

/** What the ray is tested against. */
export type AimWorld = {
  characters: readonly AimCharacter[];
  vehicles: readonly AimVehicle[];
  buildings: {
    /**
     * Calls `onBuilding` with each standing building whose footprint may meet `area` (world
     * metres), some more than once. The area is reused: read it during the call only.
     */
    visit(area: Readonly<Rect>, onBuilding: AimBuildingVisitor): void;
  };
};

/** A standing person's capsule: its radius and full height, metres. */
export const CHARACTER_RADIUS_M = 0.4;
export const CHARACTER_HEIGHT_M = 1.8;
/** A body on the ground: a low square this far each way from its centre, and this high. */
const BODY_HALF_M = 0.5;
const BODY_HEIGHT_M = 0.35;
/** The ray is walked in steps this long, the buildings near each step looked up in turn. */
export const PROBE_STEP_M = 8;
/** No building stands taller: a ray climbing past this height can meet none further on. */
const TALLEST_BUILDING_M = 120;
/** Below this a direction component counts as zero. */
const EPSILON = 1e-9;

/**
 * The ray under test in three.js space (x, height, world y), its unit direction, and the stretch
 * of it a hit may lie on: past the shooter, within reach.
 */
const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1, near: 0, far: 0 };
/** The nearest hit so far. */
const nearest: { t: number; target: AimTarget } = { t: 0, target: "sky" };
/** The ray in a box's own frame, for the slab test. */
const local = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
/** The stretch of the ray inside every slab tested so far. */
const span = { enter: 0, exit: 0 };
/** The ground under one step of the ray, whose buildings are asked for. */
const stepArea: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/** Where along the ray it passes closest to the shooter, seen from above; 0 without one. */
function passing(shooter: { x: number; y: number } | undefined): number {
  const flat = ray.dx * ray.dx + ray.dz * ray.dz;
  if (!shooter || flat < EPSILON) return 0;
  const along = (shooter.x - ray.ox) * ray.dx + (shooter.y - ray.oz) * ray.dz;
  return Math.max(0, along / flat);
}

/** Sets the ray from the camera's world matrix: its position and its −Z. */
function aimRay(
  camera: PerspectiveCamera,
  rangeM: number,
  shooter: { x: number; y: number } | undefined,
): void {
  camera.updateMatrixWorld();
  const elements = camera.matrixWorld.elements;
  const length = Math.hypot(elements[8], elements[9], elements[10]);
  ray.ox = elements[12];
  ray.oy = elements[13];
  ray.oz = elements[14];
  ray.dx = -elements[8] / length;
  ray.dy = -elements[9] / length;
  ray.dz = -elements[10] / length;
  ray.near = passing(shooter);
  ray.far = ray.near + rangeM;
}

/** Keeps a hit at `t` when it lies on the ray's stretch and nearer than the nearest so far. */
function consider(t: number, target: AimTarget): void {
  if (t < ray.near || t > ray.far || t >= nearest.t) return;
  nearest.t = t;
  nearest.target = target;
}

/** Where the ray enters a sphere of the capsule's radius about `(x, height, y)`. */
function sphereHit(x: number, height: number, y: number): number {
  const ox = ray.ox - x;
  const oy = ray.oy - height;
  const oz = ray.oz - y;
  const half = ox * ray.dx + oy * ray.dy + oz * ray.dz;
  const rest =
    ox * ox + oy * oy + oz * oz - CHARACTER_RADIUS_M * CHARACTER_RADIUS_M;
  const discriminant = half * half - rest;
  return discriminant < 0 ? Infinity : -half - Math.sqrt(discriminant);
}

/**
 * Where the ray enters an upright capsule standing at `(x, y)`: its side, or the sphere capping
 * whichever end the side hit falls beyond.
 */
function capsuleHit(x: number, y: number): number {
  const radius = CHARACTER_RADIUS_M;
  const shaft = CHARACTER_HEIGHT_M - 2 * radius;
  const ox = ray.ox - x;
  const oz = ray.oz - y;
  const flat = ray.dx * ray.dx + ray.dz * ray.dz;
  const half = ox * ray.dx + oz * ray.dz;
  const discriminant =
    half * half - flat * (ox * ox + oz * oz - radius * radius);
  if (discriminant < 0) return Infinity;
  if (flat < EPSILON)
    return sphereHit(x, ray.dy < 0 ? radius + shaft : radius, y);
  const t = (-half - Math.sqrt(discriminant)) / flat;
  const along = ray.oy - radius + t * ray.dy;
  if (along > 0 && along < shaft) return t;
  return sphereHit(x, along <= 0 ? radius : radius + shaft, y);
}

/** Narrows {@link span} to where the local ray lies between `min` and `max` on one axis. */
function clipSlab(
  origin: number,
  direction: number,
  min: number,
  max: number,
): boolean {
  if (Math.abs(direction) < EPSILON) return origin >= min && origin <= max;
  const first = (min - origin) / direction;
  const second = (max - origin) / direction;
  span.enter = Math.max(span.enter, Math.min(first, second));
  span.exit = Math.min(span.exit, Math.max(first, second));
  return span.enter <= span.exit;
}

/** Where the local ray enters the box `±halfX × [0, height] × ±halfZ`. */
function boxHit(halfX: number, height: number, halfZ: number): number {
  span.enter = -Infinity;
  span.exit = Infinity;
  const inside =
    clipSlab(local.ox, local.dx, -halfX, halfX) &&
    clipSlab(local.oy, local.dy, 0, height) &&
    clipSlab(local.oz, local.dz, -halfZ, halfZ);
  return inside ? span.enter : Infinity;
}

/** Puts the ray into the frame of a box centred at `(x, y)` whose +X runs along `heading`. */
function toLocal(x: number, y: number, heading: number): void {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const rx = ray.ox - x;
  const rz = ray.oz - y;
  local.ox = rx * cos + rz * sin;
  local.oz = rz * cos - rx * sin;
  local.oy = ray.oy;
  local.dx = ray.dx * cos + ray.dz * sin;
  local.dz = ray.dz * cos - ray.dx * sin;
  local.dy = ray.dy;
}

/** Tests every other person: the living as capsules, bodies as low boxes. */
function hitCharacters(characters: readonly AimCharacter[]): void {
  for (const character of characters) {
    if (character.self) continue;
    if (!character.dead) {
      consider(capsuleHit(character.x, character.y), "character");
      continue;
    }
    toLocal(character.x, character.y, 0);
    consider(boxHit(BODY_HALF_M, BODY_HEIGHT_M, BODY_HALF_M), "character");
  }
}

/** Tests every vehicle but your own, as a box turned to its heading. */
function hitVehicles(vehicles: readonly AimVehicle[]): void {
  for (const vehicle of vehicles) {
    if (vehicle.own) continue;
    toLocal(vehicle.x, vehicle.y, vehicle.heading);
    consider(
      boxHit(vehicle.length / 2, vehicle.height, vehicle.width / 2),
      "vehicle",
    );
  }
}

/** Where the ray crosses the wall from `from` to `to`, below `height` and past the shooter. */
function wallHit(from: Point, to: Point, height: number): number {
  const ex = to[0] - from[0];
  const ez = to[1] - from[1];
  const denominator = ray.dx * ez - ray.dz * ex;
  if (Math.abs(denominator) < EPSILON) return Infinity;
  const wx = from[0] - ray.ox;
  const wz = from[1] - ray.oz;
  const t = (wx * ez - wz * ex) / denominator;
  const along = (wx * ray.dz - wz * ray.dx) / denominator;
  if (along < 0 || along > 1 || t < ray.near) return Infinity;
  const at = ray.oy + ray.dy * t;
  return at >= 0 && at <= height ? t : Infinity;
}

/** True when `(x, y)` lies inside the ring (even-odd rule). */
function insideRing(x: number, y: number, ring: readonly Point[]): boolean {
  let inside = false;
  for (let at = 0, before = ring.length - 1; at < ring.length; before = at++) {
    const x1 = ring[at][0];
    const y1 = ring[at][1];
    const x2 = ring[before][0];
    const y2 = ring[before][1];
    if (y1 > y === y2 > y) continue;
    if (x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/** Where a ray coming down meets a building's flat top. */
function roofHit(ring: readonly Point[], height: number): number {
  if (ray.dy > -EPSILON) return Infinity;
  const t = (height - ray.oy) / ray.dy;
  if (t < ray.near) return Infinity;
  return insideRing(ray.ox + ray.dx * t, ray.oz + ray.dz * t, ring)
    ? t
    : Infinity;
}

/** Keeps where the ray first meets a building's walls or roof, past the shooter. */
function hitBuilding(ring: readonly Point[], height: number): void {
  let best = roofHit(ring, height);
  for (let at = 0, before = ring.length - 1; at < ring.length; before = at++)
    best = Math.min(best, wallHit(ring[before], ring[at], height));
  consider(best, "building");
}

/** Tests the buildings near the ray between `start` and `end` metres along it. */
function hitBuildingsAlong(
  buildings: AimWorld["buildings"],
  start: number,
  end: number,
): void {
  const x0 = ray.ox + ray.dx * start;
  const x1 = ray.ox + ray.dx * end;
  const y0 = ray.oz + ray.dz * start;
  const y1 = ray.oz + ray.dz * end;
  stepArea.minX = Math.min(x0, x1);
  stepArea.minY = Math.min(y0, y1);
  stepArea.maxX = Math.max(x0, x1);
  stepArea.maxY = Math.max(y0, y1);
  buildings.visit(stepArea, hitBuilding);
}

/**
 * Walks the ray in {@link PROBE_STEP_M} steps from the shooter up to the nearest hit so far,
 * asking for the buildings along each step only, and stops at the first step holding a hit or
 * once the ray has climbed over every roof.
 */
function hitBuildings(buildings: AimWorld["buildings"]): void {
  const limit = Math.min(ray.far, nearest.t);
  for (let start = ray.near; start < limit; start += PROBE_STEP_M) {
    const end = Math.min(limit, start + PROBE_STEP_M);
    const lowest = ray.oy + ray.dy * (ray.dy < 0 ? end : start);
    if (lowest > TALLEST_BUILDING_M) return;
    hitBuildingsAlong(buildings, start, end);
    if (nearest.t <= end) return;
  }
}

/** Writes the nearest hit, or the point at reach, into `out`. */
function writePoint(out: AimPoint): AimPoint {
  const t = Math.min(nearest.t, ray.far);
  out.x = ray.ox + ray.dx * t;
  out.y = ray.oz + ray.dz * t;
  out.height = Math.max(0, ray.oy + ray.dy * t);
  out.distance = t;
  out.target = nearest.target;
  return out;
}

/**
 * The nearest thing under the screen centre within reach (aim spec §5). Your own body and car are
 * looked through. Given the shooter, hits between the camera and them are ignored (over the
 * shoulder they stand behind the shot) and the reach is measured from where the ray passes them;
 * a ray that meets the ground before it gets there aims at that passing point. Allocates nothing
 * per call.
 *
 * @param camera - The placed city camera; its world matrix is refreshed here.
 * @param world - The characters, vehicles and buildings to test.
 * @param rangeM - How far past the shooter (or the camera) a hit may lie, metres.
 * @param out - Receives the aim point.
 * @param shooter - The local player (or their car), world metres; the camera without one.
 * @returns `out`.
 */
export function probeAim(
  camera: PerspectiveCamera,
  world: AimWorld,
  rangeM: number,
  out: AimPoint,
  shooter?: { x: number; y: number },
): AimPoint {
  aimRay(camera, rangeM, shooter);
  nearest.t = Infinity;
  nearest.target = "sky";
  const ground = ray.dy < -EPSILON ? -ray.oy / ray.dy : Infinity;
  if (ground < ray.near) {
    nearest.t = ray.near;
    nearest.target = "ground";
    return writePoint(out);
  }
  consider(ground, "ground");
  hitCharacters(world.characters);
  hitVehicles(world.vehicles);
  hitBuildings(world.buildings);
  return writePoint(out);
}
