/**
 * Shots that visibly leave the weapon (immersion spec §5). The flat simulation fires every round
 * from its shooter's body along an in-plane line at chest height; the 3D view draws each round
 * from its shooter's muzzle instead, and lets the gap between the muzzle and that line close over
 * the first {@link CONVERGE_M} metres flown. The round keeps its true speed and direction while
 * the gap closes, so it streaks out of the barrel yet lands exactly where the flat hit-scan hits
 * and the crosshair (drawn on the true line) says. Pure and allocation-free.
 */
import type { Vector3 } from "three";
import type { BulletState } from "../sim/types";
import { WEAPONS, type WeaponSpec } from "../sim/weapons";
import { PERSON_CHEST_HEIGHT_M } from "./coords";

/** Rounds are drawn from the muzzle and meet the sim's flat line after this many metres flown. */
export const CONVERGE_M = 15;

/** The part of a round that places it: where it is and where it flies. */
export type RoundLine = Pick<
  BulletState,
  "x" | "y" | "directionX" | "directionY"
>;

/**
 * How much of the gap between the muzzle and the flat line has closed after a distance flown:
 * eased in and out (a smoothstep), so the round leaves the barrel straight and settles onto the
 * line without a kink.
 *
 * @param flownM - Metres flown since the round left the barrel.
 * @returns 0 at the muzzle … 1 from {@link CONVERGE_M} on.
 */
export function convergeShare(flownM: number): number {
  const along = Math.min(1, Math.max(0, flownM / CONVERGE_M));
  return along * along * (3 - 2 * along);
}

/**
 * How far a round has flown, read from the range it has left.
 *
 * @param round - Its weapon and remaining range.
 * @returns Metres, never negative; an unknown weapon counts as long since converged.
 */
export function roundFlownM(
  round: Pick<BulletState, "weapon" | "rangeLeftM">,
): number {
  const spec: WeaponSpec | undefined = WEAPONS[round.weapon];
  return spec ? Math.max(0, spec.rangeM - round.rangeLeftM) : Infinity;
}

/**
 * Writes where a round — or the point `backM` metres behind it along its flight — is drawn, in
 * three.js space. That point sits on the flat line at chest height, lifted and shifted by the
 * muzzle's offset from the line's start, which fades out by {@link convergeShare}. A point behind
 * the round never reaches back past the line's start: that is the muzzle itself.
 *
 * @param round - The round's position and direction, world metres.
 * @param flownM - How far it has flown ({@link roundFlownM}).
 * @param muzzle - Its shooter's muzzle in three.js space, or `null` for today's in-plane point.
 * @param out - Receives the point.
 * @param backM - How far behind the round to look, metres (0 = the round itself).
 * @returns `out`.
 */
export function blendedRoundPoint(
  round: RoundLine,
  flownM: number,
  muzzle: Readonly<Vector3> | null,
  out: Vector3,
  backM = 0,
): Vector3 {
  const flown = Math.max(0, flownM);
  const back = Math.min(backM, flown);
  const at = flown - back;
  out.set(
    round.x - round.directionX * back,
    PERSON_CHEST_HEIGHT_M,
    round.y - round.directionY * back,
  );
  const keep = 1 - convergeShare(at);
  if (!muzzle || keep === 0) return out;
  const startX = round.x - round.directionX * flown;
  const startY = round.y - round.directionY * flown;
  out.x += (muzzle.x - startX) * keep;
  out.y += (muzzle.y - PERSON_CHEST_HEIGHT_M) * keep;
  out.z += (muzzle.z - startY) * keep;
  return out;
}
