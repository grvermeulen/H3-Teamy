/**
 * Street furniture that a car knocks over (spec §6.8: client-side cosmetic, not simulated): the
 * object tips a quarter turn about its own base, away from the hit, falling faster as it goes.
 */
import { Quaternion, Vector3, type Object3D } from "three";

/** Horizontal distance below which a hit is taken as dead-on, metres; it then tips east. */
const DEAD_ON_M = 1e-6;
/** A fallen object lies a quarter turn from where it stood. */
const QUARTER_TURN = Math.PI / 2;

/** An object on its way down. */
type Fall = {
  object: Object3D;
  /** Its rotation before the fall, relative to its parent. */
  standing: Quaternion;
  /** The axis it tips about, in its parent's frame. */
  axis: Vector3;
  age: number;
};

/** Knocked-over furniture. */
export type Toppling = {
  /** Starts tipping `object` over, away from the world point `(fromX, fromY)`; once per object. */
  knock(object: Object3D, fromX: number, fromY: number): void;
  /** Tips every falling object further. */
  update(dt: number): void;
};

/**
 * The horizontal axis that tips an object's top away from a world point, in its parent's frame.
 * Turning up by +θ about `up × away` swings it toward `away`.
 */
function tippingAxis(object: Object3D, fromX: number, fromY: number): Vector3 {
  object.updateWorldMatrix(true, false);
  const base = object.getWorldPosition(new Vector3());
  const away = new Vector3(base.x - fromX, 0, base.z - fromY);
  if (away.lengthSq() < DEAD_ON_M * DEAD_ON_M) away.set(1, 0, 0);
  away.normalize();
  const axis = new Vector3(away.z, 0, -away.x);
  if (object.parent)
    axis.applyQuaternion(
      object.parent.getWorldQuaternion(new Quaternion()).invert(),
    );
  return axis;
}

const tip = new Quaternion();

/**
 * Creates the toppling animation.
 *
 * @param durationS - Seconds from the hit to lying flat.
 * @returns The animation; call `update` once per frame.
 */
export function createToppling(durationS: number): Toppling {
  const knocked = new WeakSet<Object3D>();
  let falls: Fall[] = [];
  return {
    knock(object, fromX, fromY) {
      if (knocked.has(object)) return;
      knocked.add(object);
      falls.push({
        object,
        standing: object.quaternion.clone(),
        axis: tippingAxis(object, fromX, fromY),
        age: 0,
      });
    },
    update(dt) {
      for (const fall of falls) {
        fall.age += dt;
        const t = Math.min(1, fall.age / durationS);
        tip.setFromAxisAngle(fall.axis, QUARTER_TURN * t * t);
        fall.object.quaternion.multiplyQuaternions(tip, fall.standing);
      }
      if (falls.some((fall) => fall.age >= durationS))
        falls = falls.filter((fall) => fall.age < durationS);
    },
  };
}
