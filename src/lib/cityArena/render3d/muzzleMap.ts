/**
 * Where every shooter's muzzle is this frame, by owner id (immersion spec §5): written after the
 * entity sync has posed the characters, read by the tracers, rockets and muzzle flashes. Player
 * and officer ids come from the one simulation id counter, so they never collide. The vectors are
 * pooled: an owner keeps its vector while seen, and one gone for a frame hands it back for reuse,
 * so the steady state allocates nothing.
 */
import { Vector3 } from "three";

/** Muzzle points by owner id, three.js space: what the effects read. */
export type MuzzlePoints = ReadonlyMap<number, Readonly<Vector3>>;

/** The frame's muzzles. */
export type MuzzleMap = {
  /** Muzzle points by owner id, three.js space; valid until the next `begin`. */
  readonly points: MuzzlePoints;
  /** Starts a frame: every owner must be written again to stay. */
  begin(): void;
  /**
   * Records an owner's muzzle, copied into its pooled vector; a later write in the same frame wins
   * (the first-person view model's muzzle over the hidden body's).
   *
   * @param id - The shooter's id, as bullets carry it in `ownerId`.
   * @param point - The muzzle, three.js space.
   */
  set(id: number, point: Readonly<Vector3>): void;
  /** Ends a frame: forgets the owners not written since `begin`. */
  end(): void;
};

/**
 * An empty muzzle map.
 *
 * @returns The map; call `begin`, `set` per shooter and `end` every frame.
 */
export function createMuzzleMap(): MuzzleMap {
  const points = new Map<number, Vector3>();
  const seen = new Map<number, number>();
  const spare: Vector3[] = [];
  let frame = 0;
  // One callback for every frame: `forEach` walks the map without allocating entry pairs.
  const forgetUnseen = (seenFrame: number, id: number): void => {
    if (seenFrame === frame) return;
    const point = points.get(id);
    if (point) spare.push(point);
    points.delete(id);
    seen.delete(id);
  };
  return {
    points,
    begin() {
      frame += 1;
    },
    set(id, point) {
      let target = points.get(id);
      if (!target) {
        target = spare.pop() ?? new Vector3();
        points.set(id, target);
      }
      target.copy(point);
      seen.set(id, frame);
    },
    end() {
      seen.forEach(forgetUnseen);
    },
  };
}
