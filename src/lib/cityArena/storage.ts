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
