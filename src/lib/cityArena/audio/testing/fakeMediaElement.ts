import type { MediaElementLike } from "../radio/radio";

/** A fake `<audio>`: records plays and pauses, lets a test end the track or refuse a play. */
export type FakeMediaElement = MediaElementLike & {
  playCalls: number;
  pauseCalls: number;
  paused: boolean;
  /** The error the next `play()` rejects with, if any. */
  refuseWith: Error | null;
  /** Fires `ended`, as the element does when the track runs out. */
  end(): void;
};

/** Creates the fake. Assigning `src` resets `currentTime`, as the real element does on load. */
export function createFakeMediaElement(): FakeMediaElement {
  const listeners = new Map<string, Set<() => void>>();
  let src = "";
  const element: FakeMediaElement = {
    get src(): string {
      return src;
    },
    set src(value: string) {
      src = value;
      element.currentTime = 0;
    },
    currentTime: 0,
    preload: "auto",
    playCalls: 0,
    pauseCalls: 0,
    paused: true,
    refuseWith: null,
    play(): Promise<void> {
      element.playCalls += 1;
      if (element.refuseWith) {
        const error = element.refuseWith;
        element.refuseWith = null;
        return Promise.reject(error);
      }
      element.paused = false;
      return Promise.resolve();
    },
    pause(): void {
      element.pauseCalls += 1;
      element.paused = true;
    },
    addEventListener(type: string, listener: () => void): void {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void): void {
      listeners.get(type)?.delete(listener);
    },
    end(): void {
      element.paused = true;
      for (const listener of listeners.get("ended") ?? []) listener();
    },
  };
  return element;
}
