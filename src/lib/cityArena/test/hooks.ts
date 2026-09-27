import type { AmbienceLoop } from "../audio/ambience";
import type { AudioDebugSnapshot } from "../audio/sound";
import type { ArenaState, WorldInput } from "../sim/types";

/**
 * The sound seen from outside (immersion spec §6): nobody can listen to a test run, so a browser
 * check reads the levels and the voices instead. `null` before the runtime has booted.
 */
export type ArenaAudioHooks = {
  /** The level each ambience loop plays at, 0…1. */
  levels(): Record<AmbienceLoop, number> | null;
  /** The listener, the live one-shots, the recent placed events and the city's voices. */
  voices(): AudioDebugSnapshot | null;
};

/** The debug seam exposed as `window.__arena` behind `?debug=1` (spec §12.A3, minimal subset). */
export type ArenaTestHooks = {
  getState(): ArenaState | null;
  dispatch(input: Partial<WorldInput>, ticks?: number): void;
  damage(amount: number): void;
  setZoneEnforced(enabled: boolean): void;
  addHeat(amount: number): void;
  getViolations(): number;
  audio: ArenaAudioHooks;
};

/** The object the hooks hang off: the window in the browser, a plain object in tests. */
export type ArenaHookHost = { __arena?: ArenaTestHooks };

declare global {
  interface Window {
    __arena?: ArenaTestHooks;
  }
}

/** Installs the hooks on `host`; the returned uninstaller only removes them while they are still ours. */
export function installArenaHooks(
  host: ArenaHookHost,
  hooks: ArenaTestHooks,
): () => void {
  host.__arena = hooks;
  return () => {
    if (host.__arena === hooks) delete host.__arena;
  };
}
