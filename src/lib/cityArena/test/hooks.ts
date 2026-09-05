import type { ArenaState, WorldInput } from "../sim/types";

/** The debug seam exposed as `window.__arena` behind `?debug=1` (spec §12.A3, minimal subset). */
export type ArenaTestHooks = {
  getState(): ArenaState | null;
  dispatch(input: Partial<WorldInput>, ticks?: number): void;
  damage(amount: number): void;
  getViolations(): number;
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
