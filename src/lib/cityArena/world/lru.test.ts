import { describe, expect, it, vi } from "vitest";
import { createLru } from "./lru";

describe("createLru", () => {
  it("evicts the least recently used entry when the cost limit is exceeded", () => {
    const evicted: string[] = [];
    const lru = createLru<string, number>({
      maxCost: 3,
      costOf: () => 1,
      onEvict: (key) => evicted.push(key),
    });
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    expect(lru.get("a")).toBe(1);
    lru.set("d", 4);
    expect(evicted).toEqual(["b"]);
    expect(lru.keys()).toEqual(["c", "a", "d"]);
  });

  it("tracks cost by value and evicts several entries for a large one", () => {
    const onEvict = vi.fn();
    const lru = createLru<string, number>({
      maxCost: 10,
      costOf: (value) => value,
      onEvict,
    });
    lru.set("small1", 4);
    lru.set("small2", 4);
    lru.set("big", 9);
    expect(onEvict).toHaveBeenCalledTimes(2);
    expect(lru.cost).toBe(9);
    expect(lru.peek("big")).toBe(9);
  });

  it("deletes entries and reports size", () => {
    const lru = createLru<number, string>({ maxCost: 2, costOf: () => 1 });
    lru.set(1, "x");
    expect(lru.has(1)).toBe(true);
    lru.delete(1);
    expect(lru.size).toBe(0);
  });
});
