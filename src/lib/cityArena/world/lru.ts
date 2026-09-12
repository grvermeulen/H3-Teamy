/** Options for {@link createLru}. */
export type LruOptions<K, V> = {
  maxCost: number;
  costOf: (value: V) => number;
  onEvict?: (key: K, value: V) => void;
};

/** A least-recently-used cache bounded by a total cost (count, bytes, …). */
export type Lru<K, V> = {
  get(key: K): V | undefined;
  peek(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  keys(): K[];
  readonly size: number;
  readonly cost: number;
};

/** Creates an LRU whose entries are evicted oldest-first once `maxCost` is exceeded. */
export function createLru<K, V>(options: LruOptions<K, V>): Lru<K, V> {
  const entries = new Map<K, V>();
  let cost = 0;

  const evictUntilFits = (): void => {
    for (const [key, value] of entries) {
      if (cost <= options.maxCost) break;
      entries.delete(key);
      cost -= options.costOf(value);
      options.onEvict?.(key, value);
    }
  };

  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    peek: (key) => entries.get(key),
    set(key, value) {
      const previous = entries.get(key);
      if (previous !== undefined) {
        entries.delete(key);
        cost -= options.costOf(previous);
      }
      entries.set(key, value);
      cost += options.costOf(value);
      evictUntilFits();
    },
    has: (key) => entries.has(key),
    delete(key) {
      const value = entries.get(key);
      if (value === undefined) return false;
      entries.delete(key);
      cost -= options.costOf(value);
      return true;
    },
    keys: () => [...entries.keys()],
    get size() {
      return entries.size;
    },
    get cost() {
      return cost;
    },
  };
}
