/**
 * The arms of a road node: the distinct directions roads leave it in. The map build clips every
 * road to each tile it touches, and the tiles overlap, so the same street can reach a cell as two
 * copies sharing their vertices, or as two pieces meeting end to end. Counting directions instead
 * of roads makes those copies one arm each way: a straight street has two arms, a T-junction three,
 * a dead end one.
 */
import type { Point } from "../world/projection";

/** Two directions within this angle are one arm, the same road seen twice. */
const SAME_ARM_RAD = (5 * Math.PI) / 180;
/** The dot product above which two unit directions count as the same arm. */
const SAME_ARM_DOT = Math.cos(SAME_ARM_RAD);

/**
 * Adds the direction from `from` toward `to` to a node's arms, unless one of them already points
 * that way (or the two points coincide).
 *
 * @param arms - The node's arms so far, unit directions; extended in place.
 * @param from - The node.
 * @param to - A point along the road leaving it.
 */
export function addArm(arms: Point[], from: Point, to: Point): void {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const direction: Point = [dx / length, dy / length];
  for (const arm of arms)
    if (arm[0] * direction[0] + arm[1] * direction[1] > SAME_ARM_DOT) return;
  arms.push(direction);
}
