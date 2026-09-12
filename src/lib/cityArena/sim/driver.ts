import { ROAD_WIDTH_M } from "../render/palette";
import type { RoadClass } from "../world/mapTypes";
import type { Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import { CAR_BODY_RADIUS_M } from "./collisions";
import type { VehicleState } from "./types";
import {
  forwardSpeed,
  lengthOf,
  type VehicleControls,
  worldToLocal,
} from "./vehicle";

/** Gap between a lane centre and the car-body circle of oncoming traffic. */
export const LANE_CLEARANCE_M = 0.1;
/** Heading error at which steering reaches full lock. */
export const STEER_FULL_ERROR_RAD = Math.PI / 6;
/** Heading error beyond which a car slows for a turn. */
export const TURN_SLOW_ERROR_RAD = Math.PI / 4;
/** Speed held through sharp turns. */
export const TURN_SPEED_MPS = 5;
/** Speed shortfall that maps to full throttle. */
export const THROTTLE_GAIN_MPS = 3;
/** Excess speed over target that triggers braking. */
export const BRAKE_GAP_MPS = 1;
/** Below this speed a stopping car releases the brake. */
export const STOP_SPEED_MPS = 0.3;

function clampControl(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Wraps an angle into -pi..pi. */
export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Distance from the road centre to the right-hand lane. */
export function laneOffsetM(roadClass: RoadClass): number {
  return Math.max(
    ROAD_WIDTH_M[roadClass] / 4,
    CAR_BODY_RADIUS_M + LANE_CLEARANCE_M,
  );
}

/** Returns the node `to` shifted to the right of the direction from `from`. */
export function laneTarget(
  graph: Pick<RoadGraph, "nodes">,
  from: number,
  to: number,
  laneM: number,
): Point {
  const [fromX, fromY] = graph.nodes[from];
  const [toX, toY] = graph.nodes[to];
  const heading = Math.atan2(toY - fromY, toX - fromX);
  return [toX - Math.sin(heading) * laneM, toY + Math.cos(heading) * laneM];
}

/** Signed angle from the car heading to the target. */
export function headingError(vehicle: VehicleState, target: Point): number {
  return wrapAngle(
    Math.atan2(target[1] - vehicle.y, target[0] - vehicle.x) - vehicle.heading,
  );
}

/** Returns whether a point lies in the box in front of the bumper. */
export function obstacleAhead(
  vehicle: VehicleState,
  points: Point[],
  lookAheadM: number,
  halfWidthM: number,
): boolean {
  const bumper = lengthOf(vehicle.kind) / 2;
  return points.some((point) => {
    const [forward, right] = worldToLocal(vehicle, point);
    return (
      forward > bumper &&
      forward <= bumper + lookAheadM &&
      Math.abs(right) <= halfWidthM
    );
  });
}

/** The speed to hold: stop when blocked, slow through sharp turns, else cruise. */
export function desiredSpeed(
  error: number,
  cruiseMps: number,
  blocked: boolean,
): number {
  if (blocked) return 0;
  return Math.abs(error) > TURN_SLOW_ERROR_RAD
    ? Math.min(cruiseMps, TURN_SPEED_MPS)
    : cruiseMps;
}

/** Maps a speed gap to throttle or brake. */
export function throttleFor(forwardMps: number, targetMps: number): number {
  if (targetMps === 0) return forwardMps > STOP_SPEED_MPS ? -1 : 0;
  const gap = targetMps - forwardMps;
  if (gap > 0) return Math.min(1, gap / THROTTLE_GAIN_MPS);
  return gap < -BRAKE_GAP_MPS ? -1 : 0;
}

/** Controls that steer towards a target and hold the desired speed. */
export function driveControls(
  vehicle: VehicleState,
  target: Point,
  cruiseMps: number,
  blocked: boolean,
): VehicleControls {
  const error = headingError(vehicle, target);
  return {
    throttle: throttleFor(
      forwardSpeed(vehicle),
      desiredSpeed(error, cruiseMps, blocked),
    ),
    steer: clampControl(error / STEER_FULL_ERROR_RAD),
  };
}
