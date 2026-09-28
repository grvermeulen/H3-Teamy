import * as Sentry from "@sentry/nextjs";
import {
  ArenaSettingsSchema,
  DEFAULT_ARENA_SETTINGS,
  type ArenaSettings,
} from "./schemas";

/** localStorage key of the arena settings blob. */
export const ARENA_SETTINGS_KEY = "h3-arena-settings-v1";

/** Reads settings; any failure yields the defaults and is reported. */
export function loadArenaSettings(): ArenaSettings {
  if (typeof window === "undefined") return DEFAULT_ARENA_SETTINGS;
  try {
    const raw = localStorage.getItem(ARENA_SETTINGS_KEY);
    if (!raw) return DEFAULT_ARENA_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    const result = ArenaSettingsSchema.safeParse(parsed);
    if (!result.success) {
      Sentry.captureException(result.error, {
        tags: { area: "arena", kind: "settings-invalid" },
      });
      return DEFAULT_ARENA_SETTINGS;
    }
    return result.data;
  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "settings-load" },
    });
    return DEFAULT_ARENA_SETTINGS;
  }
}

/** Merges a patch into the stored settings; storage failures are reported, never thrown. */
export function saveArenaSettings(patch: Partial<ArenaSettings>): void {
  if (typeof window === "undefined") return;
  try {
    const next: ArenaSettings = { ...loadArenaSettings(), ...patch };
    localStorage.setItem(ARENA_SETTINGS_KEY, JSON.stringify(next));
  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "settings-save" },
    });
  }
}

/** localStorage key of the touch-controls tip, set once it has been read (spec §9.3). */
export const ARENA_TOUCH_TIP_KEY = "h3-arena-touch-tip-v1";
/** localStorage key of the 3D touch layout's tip (look pad, Schieten, Richten; aim round §6). */
export const ARENA_TOUCH_3D_TIP_KEY = "h3-arena-touch3d-tip-v1";

/** Which touch tip: the 2D sticks and buttons, or the 3D look pad layout. */
export type TouchTipKind = "2d" | "3d";

/** The storage key of each touch tip. */
const TOUCH_TIP_KEYS: Record<TouchTipKind, string> = {
  "2d": ARENA_TOUCH_TIP_KEY,
  "3d": ARENA_TOUCH_3D_TIP_KEY,
};

/**
 * Whether a touch tip has been read on this device; a storage failure reads as "yes".
 *
 * @param kind - Which tip; the 2D one by default.
 * @returns True once read.
 */
export function hasSeenArenaTouchTip(kind: TouchTipKind = "2d"): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(TOUCH_TIP_KEYS[kind]) !== null;
  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "touch-tip-load" },
    });
    return true;
  }
}

/**
 * Records that a touch tip has been read; a storage failure is reported, never thrown.
 *
 * @param kind - Which tip; the 2D one by default.
 */
export function markArenaTouchTipSeen(kind: TouchTipKind = "2d"): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TOUCH_TIP_KEYS[kind], "1");
  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "touch-tip-save" },
    });
  }
}
