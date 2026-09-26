/**
 * Street furniture falling over (spec §6.8: client-side cosmetic, not simulated): a lamp, bench or
 * bus shelter topples when a car sweeps past it fast, or when an explosion goes off beside it.
 * Each frame asks the city only for the furniture next to the fast cars and the new blasts, into
 * one reused list, so a frame allocates nothing.
 */
import type { Object3D } from "three";
import type { Scene } from "../render/renderScene";
import { widthOf } from "../sim/vehicle";
import type { Destruction3d } from "./destruction3d";
import type { FurnitureInstance } from "./furnitureMesh";
import { createSeenIds } from "./seenIds";
import type { WorldCells } from "./worldCells";

/** A car must move faster than this to knock furniture over, m/s. */
export const KNOCK_MIN_SPEED_MPS = 3;
/** How far past a car's side it catches furniture, metres. */
export const KNOCK_REACH_M = 1.5;
/** How far from a new explosion furniture is thrown over, metres. */
export const BLAST_KNOCK_RADIUS_M = 3;

const KNOCK_MIN_SPEED_SQ = KNOCK_MIN_SPEED_MPS * KNOCK_MIN_SPEED_MPS;

/** What the knock-overs read from a frame's scene. */
export type KnockScene = Pick<Scene, "vehicles" | "effects">;
/** Where the furniture is found: the streamed city. */
export type FurnitureSource = Pick<WorldCells, "furnitureNear">;
/** What topples it: the destruction view. */
export type KnockTarget = Pick<Destruction3d, "knockOver">;

/** Knocks furniture over from the frame's cars and explosions. */
export type KnockOvers = {
  /**
   * Knocks over, away from the cause, every standing piece of furniture within
   * {@link KNOCK_REACH_M} past the side of a car moving faster than {@link KNOCK_MIN_SPEED_MPS},
   * or within {@link BLAST_KNOCK_RADIUS_M} of an explosion seen for the first time.
   */
  update(
    scene: KnockScene,
    furniture: FurnitureSource,
    target: KnockTarget,
  ): void;
};

/**
 * Creates the knock-overs.
 *
 * @returns The knock-overs; call `update` once per frame.
 */
export function createKnockOvers(): KnockOvers {
  const down = new WeakSet<Object3D>();
  const near: FurnitureInstance[] = [];
  const blasts = createSeenIds();
  const knockAround = (
    furniture: FurnitureSource,
    target: KnockTarget,
    at: { x: number; y: number },
    radius: number,
  ): void => {
    furniture.furnitureNear(at.x, at.y, radius, near);
    for (let index = 0; index < near.length; index++) {
      const { object } = near[index];
      if (down.has(object)) continue;
      down.add(object);
      target.knockOver(object, at.x, at.y);
    }
  };
  return {
    update(scene, furniture, target) {
      for (const car of scene.vehicles) {
        const speedSq = car.velocityX ** 2 + car.velocityY ** 2;
        if (speedSq <= KNOCK_MIN_SPEED_SQ) continue;
        const reach = KNOCK_REACH_M + widthOf(car.kind) / 2;
        knockAround(furniture, target, car, reach);
      }
      for (const effect of scene.effects) {
        if (effect.kind !== "explosion" || !blasts.firstSeen(effect.id))
          continue;
        knockAround(furniture, target, effect, BLAST_KNOCK_RADIUS_M);
      }
      blasts.endFrame();
    },
  };
}
