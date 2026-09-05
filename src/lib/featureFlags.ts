import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { kvGetJson, kvSetJson } from "./kv";

/**
 * KV keys for admin-controlled feature flags, keyed by a short internal name.
 * Add new flags here and to {@link FEATURE_FLAG_DEFAULTS}.
 */
export const FEATURE_FLAGS = {
  gtaH3Launcher: "feature:gta-h3-launcher",
} as const;

/** Internal name of a feature flag (key into {@link FEATURE_FLAGS}). */
export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

/** State per flag when nothing is stored yet — GTA H3 stays hidden until an admin opts in. */
export const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  gtaH3Launcher: false,
};

/** Shape persisted in KV for a single feature flag. */
const FeatureFlagValueSchema = z.object({
  enabled: z.boolean(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});

/**
 * Reads one feature flag from KV, validating the stored shape.
 * Falls back to the flag's default (and reports to Sentry) when the stored value is malformed
 * or the read fails; falls back silently (no Sentry) when nothing is stored yet.
 *
 * @param key - Which flag to read.
 * @returns Whether the flag is enabled.
 */
export async function getFeatureFlag(key: FeatureFlagKey): Promise<boolean> {
  try {
    const stored = await kvGetJson<unknown>(FEATURE_FLAGS[key]);
    if (stored === null) return FEATURE_FLAG_DEFAULTS[key];
    const parsed = FeatureFlagValueSchema.safeParse(stored);
    if (!parsed.success) {
      Sentry.captureException(
        new Error(`Invalid feature flag value stored for "${key}"`),
        { tags: { area: "admin", kind: "feature-flag-read" } },
      );
      return FEATURE_FLAG_DEFAULTS[key];
    }
    return parsed.data.enabled;
  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { area: "admin", kind: "feature-flag-read" },
    });
    return FEATURE_FLAG_DEFAULTS[key];
  }
}

/**
 * Writes one feature flag to KV, stamping who changed it and when.
 *
 * @param key - Which flag to write.
 * @param enabled - New state.
 * @param updatedBy - Identifier (admin user id) of who made the change, kept for audit.
 */
export async function setFeatureFlag(
  key: FeatureFlagKey,
  enabled: boolean,
  updatedBy: string,
): Promise<void> {
  try {
    await kvSetJson(FEATURE_FLAGS[key], {
      enabled,
      updatedAt: new Date().toISOString(),
      updatedBy,
    });
  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { area: "admin", kind: "feature-flag-write" },
    });
    throw error;
  }
}

/**
 * Reads every known feature flag, e.g. for the admin toggle UI.
 *
 * @returns Mapping from flag key to its current enabled state.
 */
export async function getAllFeatureFlags(): Promise<
  Record<FeatureFlagKey, boolean>
> {
  // Object.keys widens to string[]; FEATURE_FLAGS is a const object so its keys are exactly
  // FeatureFlagKey.
  const keys = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[];
  const result = {} as Record<FeatureFlagKey, boolean>;
  for (const key of keys) {
    result[key] = await getFeatureFlag(key);
  }
  return result;
}
