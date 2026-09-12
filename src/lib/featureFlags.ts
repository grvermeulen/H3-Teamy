import * as Sentry from "@sentry/nextjs";
import { prisma } from "./db";
import { isPrismaSchemaDriftError } from "./prismaSchemaDrift";
import {
  shouldFallbackFromPrismaToKv,
  withPgConnectRetry,
} from "./prismaConnectRetry";

/**
 * Storage keys for admin-controlled feature flags, keyed by a short internal name.
 * Add new flags here and to {@link FEATURE_FLAG_DEFAULTS}.
 */
export const FEATURE_FLAGS = {
  gtaH3Launcher: "feature:gta-h3-launcher",
} as const;

/** Internal name of a feature flag (key into {@link FEATURE_FLAGS}). */
export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

/** State per flag when no row is stored yet — GTA H3 stays hidden until an admin opts in. */
export const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  gtaH3Launcher: false,
};

function shouldReportFeatureFlagErrorToSentry(error: unknown): boolean {
  return (
    !shouldFallbackFromPrismaToKv(error) && !isPrismaSchemaDriftError(error)
  );
}

function reportFeatureFlagError(
  error: unknown,
  kind: "feature-flag-read" | "feature-flag-write",
  operation: string,
): void {
  if (!shouldReportFeatureFlagErrorToSentry(error)) {
    Sentry.addBreadcrumb({
      category: "postgres",
      message: `Feature-flag ${operation} mislukt; val terug op default zonder Sentry-issue`,
      level: "warning",
      data: { operation, kind },
    });
    return;
  }
  Sentry.captureException(error, {
    tags: { area: "admin", kind },
  });
}

/**
 * Reads one feature flag from the `FeatureFlag` table (Postgres, shared by every instance).
 * Falls back to the flag's default (and reports to Sentry) when the read fails; falls back
 * silently (no Sentry) when no row is stored yet.
 *
 * @param key - Which flag to read.
 * @returns Whether the flag is enabled.
 */
export async function getFeatureFlag(key: FeatureFlagKey): Promise<boolean> {
  try {
    const row = await withPgConnectRetry("getFeatureFlag", () =>
      prisma.featureFlag.findUnique({ where: { key: FEATURE_FLAGS[key] } }),
    );
    return row?.enabled ?? FEATURE_FLAG_DEFAULTS[key];
  } catch (error: unknown) {
    reportFeatureFlagError(error, "feature-flag-read", "getFeatureFlag");
    return FEATURE_FLAG_DEFAULTS[key];
  }
}

/**
 * Writes one feature flag to the `FeatureFlag` table, stamping who changed it.
 *
 * @param key - Which flag to write.
 * @param enabled - New state.
 * @param updatedBy - Identifier (admin user id) of who made the change, kept for audit.
 * @throws The original error, after reporting it to Sentry.
 */
export async function setFeatureFlag(
  key: FeatureFlagKey,
  enabled: boolean,
  updatedBy: string,
): Promise<void> {
  try {
    await withPgConnectRetry("setFeatureFlag", () =>
      prisma.featureFlag.upsert({
        where: { key: FEATURE_FLAGS[key] },
        create: { key: FEATURE_FLAGS[key], enabled, updatedBy },
        update: { enabled, updatedBy },
      }),
    );
  } catch (error: unknown) {
    reportFeatureFlagError(error, "feature-flag-write", "setFeatureFlag");
    throw error;
  }
}

/**
 * Reads every known feature flag in one query, e.g. for the admin toggle UI.
 * Falls back to the defaults for every flag (and reports to Sentry) when the read fails.
 *
 * @returns Mapping from flag key to its current enabled state.
 */
export async function getAllFeatureFlags(): Promise<
  Record<FeatureFlagKey, boolean>
> {
  const keys = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[];
  try {
    const rows = await withPgConnectRetry("getAllFeatureFlags", () =>
      prisma.featureFlag.findMany({
        where: { key: { in: keys.map((key) => FEATURE_FLAGS[key]) } },
      }),
    );
    const enabledByStorageKey = new Map(
      rows.map((row) => [row.key, row.enabled]),
    );
    const result = {} as Record<FeatureFlagKey, boolean>;
    for (const key of keys) {
      result[key] =
        enabledByStorageKey.get(FEATURE_FLAGS[key]) ??
        FEATURE_FLAG_DEFAULTS[key];
    }
    return result;
  } catch (error: unknown) {
    reportFeatureFlagError(error, "feature-flag-read", "getAllFeatureFlags");
    return { ...FEATURE_FLAG_DEFAULTS };
  }
}
