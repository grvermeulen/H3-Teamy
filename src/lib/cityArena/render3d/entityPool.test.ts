import { Group } from "three";
import { describe, expect, it, vi } from "vitest";
import { createEntityPool, type Poolable } from "./entityPool";

type Fake = Poolable & { name: string; dispose: ReturnType<typeof vi.fn> };

function fake(name: string): Fake {
  return { name, object: new Group(), dispose: vi.fn() };
}

describe("createEntityPool", () => {
  it("adds a claimed object to the parent and keeps it while its entity is seen", () => {
    const parent = new Group();
    const pool = createEntityPool<Fake, { n: number }>(parent, 4);
    pool.begin();
    const slot = pool.claim(7, "a", () => fake("first"), { n: 1 });
    pool.end();
    expect(slot.item.object.parent).toBe(parent);
    expect(slot.item.object.visible).toBe(true);
    pool.begin();
    expect(pool.keep(7)).toBe(slot);
    pool.end();
    expect(pool.activeCount()).toBe(1);
    expect(slot.item.object.parent).toBe(parent);
  });

  it("hides, detaches and frees the object of an entity not seen for a frame", () => {
    const parent = new Group();
    const pool = createEntityPool<Fake, null>(parent, 4);
    pool.begin();
    const { item } = pool.claim(7, "a", () => fake("first"), null);
    pool.end();
    pool.begin();
    pool.end();
    expect(item.object.visible).toBe(false);
    expect(item.object.parent).toBeNull();
    expect(pool.keep(7)).toBeUndefined();
    expect(pool.freeCount("a")).toBe(1);
    expect(item.dispose).not.toHaveBeenCalled();
  });

  it("destroys a one-off object (no variant) when its entity leaves, never keeping it", () => {
    const parent = new Group();
    const pool = createEntityPool<Fake, null>(parent, 4);
    const create = vi.fn(() => fake("one-off"));
    pool.begin();
    const { item } = pool.claim(7, null, create, null);
    pool.end();
    pool.begin();
    pool.end();
    expect(item.dispose).toHaveBeenCalledTimes(1);
    expect(item.object.parent).toBeNull();
    pool.begin();
    pool.claim(7, null, create, null);
    pool.end();
    expect(create).toHaveBeenCalledTimes(2);
    pool.dispose();
    expect(item.dispose).toHaveBeenCalledTimes(1);
  });

  it("reuses a freed object only for the same variant", () => {
    const parent = new Group();
    const pool = createEntityPool<Fake, null>(parent, 4);
    const create = vi.fn(() => fake("new"));
    pool.begin();
    const first = pool.claim(1, "a", create, null).item;
    pool.end();
    pool.begin();
    pool.end();
    pool.begin();
    const other = pool.claim(2, "b", create, null).item;
    const reused = pool.claim(3, "a", create, null).item;
    pool.end();
    expect(create).toHaveBeenCalledTimes(2);
    expect(other).not.toBe(first);
    expect(reused).toBe(first);
    expect(reused.object.visible).toBe(true);
    expect(reused.object.parent).toBe(parent);
  });

  it("frees the old object when an id is claimed again as another variant", () => {
    const parent = new Group();
    const pool = createEntityPool<Fake, string>(parent, 4);
    pool.begin();
    const old = pool.claim(1, "a", () => fake("a"), "old").item;
    const slot = pool.claim(1, "b", () => fake("b"), "new");
    pool.end();
    expect(pool.keep(1)).toBe(slot);
    expect(slot.state).toBe("new");
    expect(old.object.parent).toBeNull();
    expect(pool.freeCount("a")).toBe(1);
    expect(pool.activeCount()).toBe(1);
  });

  it("disposes freed objects beyond the cap of each free list", () => {
    const pool = createEntityPool<Fake, null>(new Group(), 2);
    const made: Fake[] = [];
    pool.begin();
    for (let id = 0; id < 5; id += 1)
      pool.claim(id, "a", () => (made.push(fake(`${id}`)), made[id]!), null);
    pool.end();
    pool.begin();
    pool.end();
    expect(pool.freeCount("a")).toBe(2);
    expect(
      made.filter((item) => item.dispose.mock.calls.length > 0),
    ).toHaveLength(3);
  });

  it("disposes every object, in use or free, and detaches them", () => {
    const parent = new Group();
    const pool = createEntityPool<Fake, null>(parent, 4);
    pool.begin();
    const kept = pool.claim(1, "a", () => fake("kept"), null).item;
    const freed = pool.claim(2, "b", () => fake("freed"), null).item;
    pool.end();
    pool.begin();
    pool.keep(1);
    pool.end();
    pool.dispose();
    expect(kept.dispose).toHaveBeenCalledTimes(1);
    expect(freed.dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    expect(pool.activeCount()).toBe(0);
    expect(pool.freeCount("b")).toBe(0);
  });
});
