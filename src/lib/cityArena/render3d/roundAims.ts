/**
 * What each of the local shooter's rounds was aimed at (aim spec §5): the height and distance of
 * the crosshair's aim point, captured the first frame a round is seen, so it keeps climbing or
 * dipping toward the point it was fired at while the crosshair moves on. Entries are pooled by
 * bullet id, so the steady state allocates nothing.
 */
import { MIN_AIM_REACH_M } from "../input/cameraInput";
import type { BulletState } from "../sim/types";
import type { RoundAim } from "./muzzleBlend";

/** Where the local shooter's crosshair points this frame: their rounds climb or dip toward it. */
export type ShooterAim = {
  /** The local player's id, as their rounds carry it in `ownerId`. */
  ownerId: number;
  /** The aim point, world metres. */
  x: number;
  y: number;
  /** Its height above the ground, metres. */
  height: number;
};

/** A captured aim; a distance of 0 marks a round fired at a point too close to aim by. */
type HeldAim = RoundAim & { seen: boolean };

/** The rounds' captured aims, frame by frame. */
export type RoundAims = {
  /** Starts a frame: every round counts as gone until `of` sees it again. */
  begin(): void;
  /**
   * The aim a round was fired at, captured from `aim` the first frame the round is seen.
   *
   * @param round - The round in flight.
   * @param flownM - How far it has flown, metres.
   * @param aim - The local shooter's aim this frame, or `null` without one.
   * @returns Its aim, or `null` for everyone else's rounds and rounds fired at the shooter's feet.
   */
  of(
    round: BulletState,
    flownM: number,
    aim: Readonly<ShooterAim> | null,
  ): RoundAim | null;
  /** Ends a frame: forgets the rounds no longer in flight, keeping their entries for reuse. */
  end(): void;
};

/** Measures the aim point from where the round's flat line starts: the shooter. */
function capture(
  held: HeldAim,
  round: BulletState,
  flownM: number,
  aim: Readonly<ShooterAim>,
): void {
  const startX = round.x - round.directionX * flownM;
  const startY = round.y - round.directionY * flownM;
  const distance = Math.hypot(aim.x - startX, aim.y - startY);
  held.height = aim.height;
  held.distance = distance < MIN_AIM_REACH_M ? 0 : distance;
}

/**
 * Creates the registry.
 *
 * @returns The rounds' aims; each frame call `begin`, `of` per round and `end`.
 */
export function createRoundAims(): RoundAims {
  const held = new Map<number, HeldAim>();
  const spare: HeldAim[] = [];
  return {
    begin() {
      for (const entry of held.values()) entry.seen = false;
    },
    of(round, flownM, aim) {
      let entry = held.get(round.id);
      if (!entry) {
        if (!aim || round.ownerId !== aim.ownerId) return null;
        entry = spare.pop() ?? { height: 0, distance: 0, seen: false };
        capture(entry, round, flownM, aim);
        held.set(round.id, entry);
      }
      entry.seen = true;
      return entry.distance > 0 ? entry : null;
    },
    end() {
      for (const [id, entry] of held) {
        if (entry.seen) continue;
        held.delete(id);
        spare.push(entry);
      }
    },
  };
}
