import type { CollisionGrid } from "../world/collisionGrid";
import type { Point } from "../world/projection";
import type { VehicleKind, VehicleState } from "./types";

/** Static car parameters (spec §5). */
export type VehicleSpec = {
  label: string;
  accelMps2: number;
  maxSpeedMps: number;
};

/** Car table with Dutch labels. */
export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = {
  compact: { label: "Compact", accelMps2: 6, maxSpeedMps: 22 },
  sedan: { label: "Sedan", accelMps2: 8, maxSpeedMps: 28 },
  sport: { label: "Sportwagen", accelMps2: 11, maxSpeedMps: 36 },
  police: { label: "Politieauto", accelMps2: 9, maxSpeedMps: 30 },
};

/** Body length in metres. */
export const VEHICLE_LENGTH_M = 4.2;
/** Body width in metres. */
export const VEHICLE_WIDTH_M = 1.8;
/** Braking deceleration (spec §5). */
export const BRAKE_MPS2 = 14;
/** Top speed in reverse (spec §5). */
export const REVERSE_MAX_MPS = 8;
/** Full-lock turn rate at grip speed (spec §5). */
export const STEER_RATE_RAD_S = 2.6;
/** Speed at which the steering reaches full authority (spec §5: clamp(v/6)). */
export const STEER_FULL_SPEED_MPS = 6;
/** Steering loss at top speed (spec §5: 1 − 0.5·v/vmax). */
export const STEER_HIGH_SPEED_FACTOR = 0.5;
/** Fraction of the lateral velocity that survives one second (spec §5: decays 90 %/s). */
export const LATERAL_KEEP_PER_S = 0.1;
/** Deceleration when neither throttle nor brake is applied (documented choice). */
export const ROLLING_DECEL_MPS2 = 3;
/** Distance of the two hull circles from the centre along the body axis. */
export const HULL_CIRCLE_OFFSET_M = 1.1;
/** Radius of each hull circle used against buildings and water. */
export const HULL_CIRCLE_RADIUS_M = 0.95;
/** Bounce factor of collisions (spec §5). */
export const RESTITUTION = 0.3;
/** Car health at spawn (spec §5). */
export const VEHICLE_MAX_HEALTH = 100;
/** Below this health the car smokes (spec §5). */
export const SMOKE_HEALTH = 40;
/** Number of body colours the render palette offers; `colour` stays below it. */
export const VEHICLE_COLOUR_COUNT = 6;

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
    health: VEHICLE_MAX_HEALTH,
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
  const halfLength = VEHICLE_LENGTH_M / 2;
  const halfWidth = VEHICLE_WIDTH_M / 2;
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
  const outsideForward = Math.max(0, Math.abs(forward) - VEHICLE_LENGTH_M / 2);
  const outsideRight = Math.max(0, Math.abs(right) - VEHICLE_WIDTH_M / 2);
  return Math.hypot(outsideForward, outsideRight);
}

/** Centres of the two collision circles along the body axis, front first. */
export function hullCircles(vehicle: VehicleState): Point[] {
  return [
    localToWorld(vehicle, [HULL_CIRCLE_OFFSET_M, 0]),
    localToWorld(vehicle, [-HULL_CIRCLE_OFFSET_M, 0]),
  ];
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

/** Turn rate in rad/s: steer × 2.6 × clamp(v/6, 0, 1) × (1 − 0.5·v/vmax), mirrored in reverse. */
function turnRate(forward: number, steer: number, spec: VehicleSpec): number {
  const speed = Math.abs(forward);
  const grip = Math.min(1, speed / STEER_FULL_SPEED_MPS);
  const highSpeedLoss =
    1 - STEER_HIGH_SPEED_FACTOR * (speed / spec.maxSpeedMps);
  const direction = forward < 0 ? -1 : 1;
  return steer * STEER_RATE_RAD_S * grip * highSpeedLoss * direction;
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
  for (const centre of hullCircles(vehicle)) {
    const resolved = collision.resolveCircle(centre, HULL_CIRCLE_RADIUS_M);
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
