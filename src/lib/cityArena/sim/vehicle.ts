import type { CollisionGrid } from "../world/collisionGrid";
import type { Point } from "../world/projection";
import type { VehicleKind, VehicleState } from "./types";

/** Static car parameters (spec §5; widened by Plan 9 so kinds differ in more than speed). */
export type VehicleSpec = {
  label: string;
  accelMps2: number;
  maxSpeedMps: number;
  /** Full-lock turn rate at grip speed: a bus turns slowly, a compact quickly. */
  steerRateRadS: number;
  /** Health at spawn; a bus takes far more than a compact. */
  healthMax: number;
  lengthM: number;
  widthM: number;
  /** Tonnes; weights what two cars trade in a collision — the lighter one moves and hurts more. */
  massT: number;
};

/**
 * Every kind, in wire order: the index travels in a snapshot, so this list is appended to, never
 * reordered.
 */
export const VEHICLE_KINDS: readonly VehicleKind[] = [
  "compact",
  "sedan",
  "sport",
  "police",
  "van",
  "pickup",
  "bus",
  "oldtimer",
  "tractor",
];

/** Body length of the four original kinds, metres; the others carry their own. */
export const VEHICLE_LENGTH_M = 4.2;
/** Body width of the four original kinds, metres. */
export const VEHICLE_WIDTH_M = 1.8;
/** Full-lock turn rate of the four original kinds at grip speed (spec §5). */
export const STEER_RATE_RAD_S = 2.6;
/** Health at spawn of the four original kinds (spec §5). */
export const VEHICLE_MAX_HEALTH = 100;

/** The four original kinds share one body, one handling and one health. */
const ORIGINAL_BODY = {
  steerRateRadS: STEER_RATE_RAD_S,
  healthMax: VEHICLE_MAX_HEALTH,
  lengthM: VEHICLE_LENGTH_M,
  widthM: VEHICLE_WIDTH_M,
};

/** Car table with Dutch labels. */
export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = {
  compact: {
    label: "Compact",
    accelMps2: 6,
    maxSpeedMps: 22,
    ...ORIGINAL_BODY,
    massT: 1.2,
  },
  sedan: {
    label: "Sedan",
    accelMps2: 8,
    maxSpeedMps: 28,
    ...ORIGINAL_BODY,
    massT: 1.4,
  },
  sport: {
    label: "Sportwagen",
    accelMps2: 11,
    maxSpeedMps: 36,
    ...ORIGINAL_BODY,
    massT: 1.3,
  },
  police: {
    label: "Politieauto",
    accelMps2: 9,
    maxSpeedMps: 30,
    ...ORIGINAL_BODY,
    massT: 1.6,
  },
  van: {
    label: "Bestelbus",
    accelMps2: 5,
    maxSpeedMps: 24,
    steerRateRadS: 2.2,
    healthMax: 140,
    lengthM: 5,
    widthM: 2,
    massT: 2.2,
  },
  pickup: {
    label: "Pick-up",
    accelMps2: 7,
    maxSpeedMps: 27,
    steerRateRadS: 2.4,
    healthMax: 120,
    lengthM: 5.2,
    widthM: 1.9,
    massT: 2,
  },
  bus: {
    label: "Stadsbus",
    accelMps2: 3,
    maxSpeedMps: 18,
    steerRateRadS: 1.6,
    healthMax: 220,
    lengthM: 12,
    widthM: 2.5,
    massT: 12,
  },
  oldtimer: {
    label: "Oldtimer",
    accelMps2: 5,
    maxSpeedMps: 20,
    steerRateRadS: 2.3,
    healthMax: 70,
    lengthM: 4.4,
    widthM: 1.7,
    massT: 1.1,
  },
  tractor: {
    label: "Trekker",
    accelMps2: 2,
    maxSpeedMps: 8,
    steerRateRadS: 1.8,
    healthMax: 180,
    lengthM: 4,
    widthM: 2.2,
    massT: 4,
  },
};

/** Braking deceleration (spec §5). */
export const BRAKE_MPS2 = 14;
/** Top speed in reverse (spec §5). */
export const REVERSE_MAX_MPS = 8;
/** Speed at which the steering reaches full authority (spec §5: clamp(v/6)). */
export const STEER_FULL_SPEED_MPS = 6;
/** Steering loss at top speed (spec §5: 1 − 0.5·v/vmax). */
export const STEER_HIGH_SPEED_FACTOR = 0.5;
/**
 * Steering authority a rolling car has straight away, before speed adds the rest. Without it the
 * spec's `clamp(v/6, 0, 1)` curve leaves the wheel almost dead below walking pace and then snaps.
 */
export const STEER_GRIP_FLOOR = 0.45;
/** Below this speed the car does not turn at all, so a parked car never pivots on the spot. */
export const STEER_MIN_SPEED_MPS = 0.5;
/** Fraction of the lateral velocity that survives one second (spec §5: decays 90 %/s). */
export const LATERAL_KEEP_PER_S = 0.1;
/** Deceleration when neither throttle nor brake is applied (documented choice). */
export const ROLLING_DECEL_MPS2 = 3;
/** Distance of the two hull circles from the centre along the body axis, for the original kinds. */
export const HULL_CIRCLE_OFFSET_M = 1.1;
/** Radius of each hull circle used against buildings and water, for the original kinds. */
export const HULL_CIRCLE_RADIUS_M = 0.95;
/** Hull circle radius per metre of body width: the original kinds' 0.95 m for their 1.8 m. */
const HULL_RADIUS_PER_WIDTH = HULL_CIRCLE_RADIUS_M / VEHICLE_WIDTH_M;
/** How far the end circles sit inside the bumpers: the original kinds' 2.1 − 1.1 m. */
const HULL_END_INSET_M = VEHICLE_LENGTH_M / 2 - HULL_CIRCLE_OFFSET_M;
/** Target spacing between neighbouring hull circles along a long body. */
const HULL_CIRCLE_SPACING_M = 2;
/** Bounce factor of collisions (spec §5). */
export const RESTITUTION = 0.3;
/** Below this share of its health a car smokes (spec §5's 40 of 100). */
export const SMOKE_HEALTH_SHARE = 0.4;
/** Below this health one of the original kinds smokes (spec §5). */
export const SMOKE_HEALTH = VEHICLE_MAX_HEALTH * SMOKE_HEALTH_SHARE;
/** Number of body colours the render palette offers; `colour` stays below it. */
export const VEHICLE_COLOUR_COUNT = 10;

/** Body length of a kind, metres. */
export function lengthOf(kind: VehicleKind): number {
  return VEHICLE_SPECS[kind].lengthM;
}

/** Body width of a kind, metres. */
export function widthOf(kind: VehicleKind): number {
  return VEHICLE_SPECS[kind].widthM;
}

/** Health a kind spawns with. */
export function healthMaxOf(kind: VehicleKind): number {
  return VEHICLE_SPECS[kind].healthMax;
}

/** Below this health a kind smokes. */
export function smokeHealthOf(kind: VehicleKind): number {
  return VEHICLE_SPECS[kind].healthMax * SMOKE_HEALTH_SHARE;
}

/** Mass of a kind, tonnes. */
export function massOf(kind: VehicleKind): number {
  return VEHICLE_SPECS[kind].massT;
}

/** Where a kind's hull circles sit along the body, front first in car-local metres, and their radius. */
export type HullLayout = { offsetsM: readonly number[]; radiusM: number };

/**
 * The hull of a kind: circles along the body axis, one per ~2 m so a bus is a bus, at the radius
 * its width calls for. The four original kinds keep their two circles at ±1.1 m, r 0.95.
 */
function computeHullLayout(kind: VehicleKind): HullLayout {
  const spec = VEHICLE_SPECS[kind];
  const span = spec.lengthM - 2 * HULL_END_INSET_M;
  const count = Math.max(2, Math.round(span / HULL_CIRCLE_SPACING_M) + 1);
  const offsetsM = Array.from(
    { length: count },
    (_, index) => span / 2 - (span * index) / (count - 1),
  );
  return { offsetsM, radiusM: spec.widthM * HULL_RADIUS_PER_WIDTH };
}

/** The hull layout of every kind, computed once. */
const HULL_LAYOUTS: Record<VehicleKind, HullLayout> = Object.fromEntries(
  VEHICLE_KINDS.map((kind) => [kind, computeHullLayout(kind)]),
) as Record<VehicleKind, HullLayout>;

/**
 * The hull layout of a kind.
 *
 * @param kind - The kind.
 * @returns Its circle offsets along the body and their radius.
 */
export function hullLayout(kind: VehicleKind): HullLayout {
  return HULL_LAYOUTS[kind];
}

/** Driver controls in −1..1: throttle (negative brakes/reverses) and steer (positive right). */
export type VehicleControls = { throttle: number; steer: number };

/** Controls of a car nobody is driving. */
export const NO_CONTROLS: VehicleControls = { throttle: 0, steer: 0 };

/** Outcome of one car step; `impactSpeed` is the approach speed lost against an obstacle (0 when none). */
export type VehicleStepResult = { vehicle: VehicleState; impactSpeed: number };

/** Pushes shorter than this are treated as no contact. */
const PUSH_EPSILON_M = 1e-6;
/** Hull push-out passes: a car nosed into a corner needs a second pass to clear both circles. */
const HULL_RESOLVE_ITERATIONS = 3;

/** A parked, undamaged car. */
export function createVehicle(
  id: number,
  kind: VehicleKind,
  position: Point,
  heading: number,
  colour: number,
): VehicleState {
  return {
    id,
    kind,
    x: position[0],
    y: position[1],
    heading,
    velocityX: 0,
    velocityY: 0,
    health: healthMaxOf(kind),
    wrecked: false,
    colour,
  };
}

/** Velocity component along the heading (negative when reversing). */
export function forwardSpeed(vehicle: VehicleState): number {
  return (
    vehicle.velocityX * Math.cos(vehicle.heading) +
    vehicle.velocityY * Math.sin(vehicle.heading)
  );
}

/** Velocity component to the driver's right. */
function lateralSpeed(vehicle: VehicleState): number {
  return (
    -vehicle.velocityX * Math.sin(vehicle.heading) +
    vehicle.velocityY * Math.cos(vehicle.heading)
  );
}

/** Car-local `[forward, right]` metres to world metres. */
export function localToWorld(vehicle: VehicleState, local: Point): Point {
  const cos = Math.cos(vehicle.heading);
  const sin = Math.sin(vehicle.heading);
  return [
    vehicle.x + local[0] * cos - local[1] * sin,
    vehicle.y + local[0] * sin + local[1] * cos,
  ];
}

/** World metres to car-local `[forward, right]` metres. */
export function worldToLocal(vehicle: VehicleState, point: Point): Point {
  const cos = Math.cos(vehicle.heading);
  const sin = Math.sin(vehicle.heading);
  const dx = point[0] - vehicle.x;
  const dy = point[1] - vehicle.y;
  return [dx * cos + dy * sin, -dx * sin + dy * cos];
}

/** The four body corners: front-left, front-right, rear-right, rear-left. */
export function vehicleCorners(vehicle: VehicleState): Point[] {
  const halfLength = lengthOf(vehicle.kind) / 2;
  const halfWidth = widthOf(vehicle.kind) / 2;
  const locals: Point[] = [
    [halfLength, -halfWidth],
    [halfLength, halfWidth],
    [-halfLength, halfWidth],
    [-halfLength, -halfWidth],
  ];
  return locals.map((local) => localToWorld(vehicle, local));
}

/** Distance from a point to the car body (0 inside). */
export function distanceToVehicle(vehicle: VehicleState, point: Point): number {
  const [forward, right] = worldToLocal(vehicle, point);
  const outsideForward = Math.max(
    0,
    Math.abs(forward) - lengthOf(vehicle.kind) / 2,
  );
  const outsideRight = Math.max(0, Math.abs(right) - widthOf(vehicle.kind) / 2);
  return Math.hypot(outsideForward, outsideRight);
}

/** Centres of the collision circles along the body axis, front first. */
export function hullCircles(vehicle: VehicleState): Point[] {
  return hullLayout(vehicle.kind).offsetsM.map((offset) =>
    localToWorld(vehicle, [offset, 0]),
  );
}

/** Clamps a control value to −1..1. */
function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Forward speed after one tick of throttle, braking, reversing or rolling deceleration. */
function driveForward(
  forward: number,
  throttle: number,
  spec: VehicleSpec,
  dt: number,
): number {
  if (throttle > 0 && forward >= 0)
    return Math.min(spec.maxSpeedMps, forward + spec.accelMps2 * throttle * dt);
  if (throttle > 0) return Math.min(0, forward + BRAKE_MPS2 * dt);
  if (throttle < 0 && forward > 0)
    return Math.max(0, forward - BRAKE_MPS2 * dt);
  if (throttle < 0)
    return Math.max(-REVERSE_MAX_MPS, forward + spec.accelMps2 * throttle * dt);
  const rollOff = ROLLING_DECEL_MPS2 * dt;
  if (Math.abs(forward) <= rollOff) return 0;
  return forward - Math.sign(forward) * rollOff;
}

/**
 * Steering authority at `speed`: none while the car is effectively parked, {@link STEER_GRIP_FLOOR}
 * the moment it rolls, and a full 1 from {@link STEER_FULL_SPEED_MPS} upward — so nothing about
 * cornering at speed changes.
 */
function steerGrip(speed: number): number {
  if (speed < STEER_MIN_SPEED_MPS) return 0;
  return (
    STEER_GRIP_FLOOR +
    (1 - STEER_GRIP_FLOOR) * Math.min(1, speed / STEER_FULL_SPEED_MPS)
  );
}

/** Turn rate in rad/s: steer × 2.6 × {@link steerGrip} × (1 − 0.5·v/vmax), mirrored in reverse. */
function turnRate(forward: number, steer: number, spec: VehicleSpec): number {
  const speed = Math.abs(forward);
  const highSpeedLoss =
    1 - STEER_HIGH_SPEED_FACTOR * (speed / spec.maxSpeedMps);
  const direction = forward < 0 ? -1 : 1;
  return (
    steer * spec.steerRateRadS * steerGrip(speed) * highSpeedLoss * direction
  );
}

/** Applies the controls to velocity and heading; wrecks ignore their controls. */
function applyDrive(
  vehicle: VehicleState,
  controls: VehicleControls,
  dt: number,
): VehicleState {
  const spec = VEHICLE_SPECS[vehicle.kind];
  const throttle = vehicle.wrecked ? 0 : clampUnit(controls.throttle);
  const steer = vehicle.wrecked ? 0 : clampUnit(controls.steer);
  const forward = driveForward(forwardSpeed(vehicle), throttle, spec, dt);
  const lateral = lateralSpeed(vehicle) * Math.pow(LATERAL_KEEP_PER_S, dt);
  const heading = vehicle.heading + turnRate(forward, steer, spec) * dt;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    ...vehicle,
    heading,
    velocityX: forward * cos - lateral * sin,
    velocityY: forward * sin + lateral * cos,
  };
}

/** The longest push-out among the hull circles this pass, or `null` when neither overlaps. */
function strongestCirclePush(
  vehicle: VehicleState,
  collision: Pick<CollisionGrid, "resolveCircle">,
): Point | null {
  let best: Point = [0, 0];
  let bestLength = 0;
  const { radiusM } = hullLayout(vehicle.kind);
  for (const centre of hullCircles(vehicle)) {
    const resolved = collision.resolveCircle(centre, radiusM);
    const push: Point = [resolved[0] - centre[0], resolved[1] - centre[1]];
    const length = Math.hypot(push[0], push[1]);
    if (length > bestLength) {
      best = push;
      bestLength = length;
    }
  }
  return bestLength > PUSH_EPSILON_M ? best : null;
}

/**
 * Total push-out that clears both hull circles, or `null` when neither overlaps. A single pass
 * only resolves the more penetrating circle, which can leave the other still overlapping when
 * the car is nosed into a corner (the two circles hit different obstacles); this re-checks both
 * after every push and stops as soon as neither needs one, up to {@link HULL_RESOLVE_ITERATIONS}.
 */
function hullPushOut(
  vehicle: VehicleState,
  collision: Pick<CollisionGrid, "resolveCircle">,
): Point | null {
  let total: Point = [0, 0];
  let current = vehicle;
  for (let pass = 0; pass < HULL_RESOLVE_ITERATIONS; pass++) {
    const push = strongestCirclePush(current, collision);
    if (!push) break;
    total = [total[0] + push[0], total[1] + push[1]];
    current = { ...current, x: current.x + push[0], y: current.y + push[1] };
  }
  return Math.hypot(total[0], total[1]) > PUSH_EPSILON_M ? total : null;
}

/** Moves the car by its velocity, pushes it out of obstacles and reflects the approach velocity with restitution. */
function moveAndCollide(
  vehicle: VehicleState,
  dt: number,
  collision: Pick<CollisionGrid, "resolveCircle">,
): VehicleStepResult {
  const moved: VehicleState = {
    ...vehicle,
    x: vehicle.x + vehicle.velocityX * dt,
    y: vehicle.y + vehicle.velocityY * dt,
  };
  const push = hullPushOut(moved, collision);
  if (!push) return { vehicle: moved, impactSpeed: 0 };
  const length = Math.hypot(push[0], push[1]);
  const normalX = push[0] / length;
  const normalY = push[1] / length;
  const impactSpeed = Math.max(
    0,
    -(moved.velocityX * normalX + moved.velocityY * normalY),
  );
  const bounce = (1 + RESTITUTION) * impactSpeed;
  return {
    vehicle: {
      ...moved,
      x: moved.x + push[0],
      y: moved.y + push[1],
      velocityX: moved.velocityX + normalX * bounce,
      velocityY: moved.velocityY + normalY * bounce,
    },
    impactSpeed,
  };
}

/** Advances one car by `dt` seconds under `controls`, resolving buildings and water. */
export function stepVehicle(
  vehicle: VehicleState,
  controls: VehicleControls,
  dt: number,
  collision: Pick<CollisionGrid, "resolveCircle">,
): VehicleStepResult {
  return moveAndCollide(applyDrive(vehicle, controls, dt), dt, collision);
}
