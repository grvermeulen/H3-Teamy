/**
 * Scene objects kept per entity id and recycled through free lists by variant (a look, or a
 * vehicle's kind and colour), so the 3D cast creates a model only when more of a variant are on
 * screen than ever before. A one-off object (no variant, e.g. another player in their own vest
 * hue) is never asked for again, so it is destroyed as soon as its entity leaves.
 */
import type { Object3D } from "three";

/** Anything the pool holds: a scene object that can free itself. */
export type Poolable = {
  object: Object3D;
  /** Frees the object's own resources; the pool detaches it first. */
  dispose(): void;
};

/** One entity's object with the per-entity memory the caller keeps beside it. */
export type PoolSlot<T extends Poolable, S> = {
  item: T;
  /**
   * What the object was built as; a freed object serves only the same variant again. `null` for
   * a one-off, destroyed when freed.
   */
  variant: string | null;
  state: S;
  /** The frame it was last seen in. */
  seenFrame: number;
};

/** Pooled objects for one kind of entity, keyed by entity id. */
export type EntityPool<T extends Poolable, S> = {
  /** Starts a frame: every entity must be kept or claimed again to stay. */
  begin(): void;
  /** The slot `id` held since an earlier frame, marked as seen; `undefined` when it has none. */
  keep(id: number): PoolSlot<T, S> | undefined;
  /**
   * Gives `id` a slot, shown under the parent: a freed object of `variant` if there is one, else
   * a new one from `create`. An object `id` already held (of another variant) is freed first.
   * A `null` variant is a one-off: always new, and destroyed rather than kept once freed.
   */
  claim(
    id: number,
    variant: string | null,
    create: () => T,
    state: S,
  ): PoolSlot<T, S>;
  /** Ends a frame: frees the objects of entities not seen since {@link begin}. */
  end(): void;
  /** Objects in use. */
  activeCount(): number;
  /** Freed objects waiting for reuse as `variant`. */
  freeCount(variant: string): number;
  /** Detaches and disposes every object, in use or free. */
  dispose(): void;
};

/** Detaches an object and frees it. */
function destroy(item: Poolable): void {
  item.object.removeFromParent();
  item.dispose();
}

/** Free lists by variant, each capped; an object beyond the cap is destroyed. */
function createFreeLists<T extends Poolable>(
  cap: number,
): {
  take(variant: string): T | undefined;
  put(variant: string, item: T): void;
  count(variant: string): number;
  clear(): void;
} {
  const lists = new Map<string, T[]>();
  return {
    take: (variant) => lists.get(variant)?.pop(),
    put(variant, item) {
      let list = lists.get(variant);
      if (!list) {
        list = [];
        lists.set(variant, list);
      }
      if (list.length < cap) list.push(item);
      else destroy(item);
    },
    count: (variant) => lists.get(variant)?.length ?? 0,
    clear() {
      for (const list of lists.values()) list.forEach(destroy);
      lists.clear();
    },
  };
}

/**
 * A pool of scene objects by entity id. A freed object is hidden and detached, then kept for the
 * next entity of its variant; each variant keeps at most `freeCap` of them and destroys the rest.
 *
 * @param parent - Where claimed objects are shown.
 * @param freeCap - Freed objects kept per variant.
 * @returns The pool; call `begin`, then `keep`/`claim` per visible entity, then `end` each frame.
 */
export function createEntityPool<T extends Poolable, S>(
  parent: Object3D,
  freeCap: number,
): EntityPool<T, S> {
  const active = new Map<number, PoolSlot<T, S>>();
  const free = createFreeLists<T>(freeCap);
  let frame = 0;
  const release = (slot: PoolSlot<T, S>, id: number): void => {
    active.delete(id);
    if (slot.variant === null) {
      destroy(slot.item);
      return;
    }
    slot.item.object.visible = false;
    slot.item.object.removeFromParent();
    free.put(slot.variant, slot.item);
  };
  // One callback for every frame: `forEach` walks the map without allocating entry pairs.
  const releaseUnseen = (slot: PoolSlot<T, S>, id: number): void => {
    if (slot.seenFrame !== frame) release(slot, id);
  };
  return {
    begin() {
      frame += 1;
    },
    keep(id) {
      const slot = active.get(id);
      if (slot) slot.seenFrame = frame;
      return slot;
    },
    claim(id, variant, create, state) {
      const held = active.get(id);
      if (held) release(held, id);
      const item =
        (variant === null ? undefined : free.take(variant)) ?? create();
      item.object.visible = true;
      parent.add(item.object);
      const slot = { item, variant, state, seenFrame: frame };
      active.set(id, slot);
      return slot;
    },
    end() {
      active.forEach(releaseUnseen);
    },
    activeCount: () => active.size,
    freeCount: (variant) => free.count(variant),
    dispose() {
      for (const slot of active.values()) destroy(slot.item);
      active.clear();
      free.clear();
    },
  };
}
