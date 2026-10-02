import { describe, expect, it } from "vitest";
import { createBinaryHeap } from "./binaryHeap";

describe("createBinaryHeap", () => {
  it("pops items in ascending priority order", () => {
    const heap = createBinaryHeap<string>();
    heap.push("five", 5);
    heap.push("one", 1);
    heap.push("three", 3);
    heap.push("two", 2);
    expect(heap.size()).toBe(4);
    expect(heap.pop()).toBe("one");
    expect(heap.pop()).toBe("two");
    heap.push("zero", 0);
    expect(heap.pop()).toBe("zero");
    expect(heap.pop()).toBe("three");
    expect(heap.pop()).toBe("five");
    expect(heap.pop()).toBeNull();
    expect(heap.size()).toBe(0);
  });

  it("keeps a long shuffled sequence sorted", () => {
    const heap = createBinaryHeap<number>();
    const values = Array.from(
      { length: 200 },
      (_, index) => (index * 37) % 101,
    );
    for (const value of values) heap.push(value, value);
    const popped: number[] = [];
    for (let item = heap.pop(); item !== null; item = heap.pop())
      popped.push(item);
    expect(popped).toEqual([...values].sort((left, right) => left - right));
  });
});
