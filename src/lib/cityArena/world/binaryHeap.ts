/** A min-heap keyed by a numeric priority. */
export type BinaryHeap<T> = {
  push(item: T, priority: number): void;
  pop(): T | null;
  size(): number;
};

function swap<T>(
  items: T[],
  priorities: number[],
  first: number,
  second: number,
): void {
  [items[first], items[second]] = [items[second], items[first]];
  [priorities[first], priorities[second]] = [
    priorities[second],
    priorities[first],
  ];
}

function siftUp<T>(items: T[], priorities: number[], index: number): void {
  let current = index;
  while (current > 0) {
    const parent = (current - 1) >> 1;
    if (priorities[parent] <= priorities[current]) return;
    swap(items, priorities, parent, current);
    current = parent;
  }
}

function siftDown<T>(items: T[], priorities: number[], index: number): void {
  let current = index;
  for (;;) {
    const left = current * 2 + 1;
    const right = left + 1;
    let smallest = current;
    if (left < items.length && priorities[left] < priorities[smallest])
      smallest = left;
    if (right < items.length && priorities[right] < priorities[smallest])
      smallest = right;
    if (smallest === current) return;
    swap(items, priorities, current, smallest);
    current = smallest;
  }
}

/** Creates an empty numeric-priority min-heap. */
export function createBinaryHeap<T>(): BinaryHeap<T> {
  const items: T[] = [];
  const priorities: number[] = [];
  return {
    push(item, priority) {
      items.push(item);
      priorities.push(priority);
      siftUp(items, priorities, items.length - 1);
    },
    pop() {
      if (items.length === 0) return null;
      const first = items[0];
      const last = items.length - 1;
      items[0] = items[last];
      priorities[0] = priorities[last];
      items.pop();
      priorities.pop();
      if (items.length > 0) siftDown(items, priorities, 0);
      return first;
    },
    size: () => items.length,
  };
}
