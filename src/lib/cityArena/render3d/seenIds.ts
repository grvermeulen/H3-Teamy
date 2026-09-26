/**
 * Which ids of a per-frame list were seen for the first time. The simulation runs at 30 Hz and the
 * renderer at display rate, so an effect stays in the scene for several frames; reacting to it
 * once means remembering the ids the last frame had.
 */

/** Which ids a frame has already seen. */
export type SeenIds = {
  /** Records an id seen this frame; true when the previous frame did not have it. */
  firstSeen(id: number): boolean;
  /** Closes the frame: ids it did not record are forgotten. */
  endFrame(): void;
};

/**
 * Remembers the ids of the last frame, so each is reacted to exactly once. Two sets swap roles
 * every frame, so the memory never outgrows the list and a frame allocates nothing.
 *
 * @returns The memory; call `firstSeen` for each id of a frame, then `endFrame`.
 */
export function createSeenIds(): SeenIds {
  let previous = new Set<number>();
  let current = new Set<number>();
  return {
    firstSeen(id) {
      if (current.has(id)) return false;
      current.add(id);
      return !previous.has(id);
    },
    endFrame() {
      const done = previous;
      previous = current;
      current = done;
      current.clear();
    },
  };
}
