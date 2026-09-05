"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";
import type { FeatureFlagKey } from "@/lib/featureFlags";

/** Dutch copy shown when saving a toggle fails and the optimistic change is reverted. */
const SAVE_FAILED_MESSAGE = "Opslaan mislukt, probeer het opnieuw";

/** One switch row: internal flag key paired with its Dutch label, in render order. */
const FEATURE_TOGGLE_ROWS: { key: FeatureFlagKey; label: string }[] = [
  { key: "gtaH3Launcher", label: "GTA H3 spel tonen" },
];

/** Fetches the current feature flag state from the admin API; `null` on any failure. */
async function fetchFeatureFlags(): Promise<Record<
  FeatureFlagKey,
  boolean
> | null> {
  try {
    const res = await fetch("/api/admin/features", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      flags: Record<FeatureFlagKey, boolean>;
    };
    return data.flags;
  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { area: "admin", kind: "feature-flag-read" },
    });
    return null;
  }
}

/** Sends an updated flag value to the admin API; resolves to whether it succeeded. */
async function patchFeatureFlag(
  key: FeatureFlagKey,
  enabled: boolean,
): Promise<boolean> {
  try {
    const res = await fetch("/api/admin/features", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, enabled }),
    });
    return res.ok;
  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { area: "admin", kind: "feature-flag-write" },
    });
    return false;
  }
}

/** Props for {@link FeatureToggleRow}. */
type FeatureToggleRowProps = {
  label: string;
  enabled: boolean;
  onToggle: () => void;
};

/** One accessible switch row: label plus a `role="switch"` button reflecting its state. */
function FeatureToggleRow({
  label,
  enabled,
  onToggle,
}: FeatureToggleRowProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-0 p-0 transition-colors ${
          enabled ? "bg-cyan-500" : "bg-[#30363d]"
        }`}
      >
        <span
          className={`pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

/**
 * Admin section listing admin-controlled feature flags as switch rows (KV-backed, see
 * `src/lib/featureFlags.ts`). Loads state on mount and updates optimistically, reverting with a
 * Dutch error message when the server rejects the change.
 */
export default function FeatureToggles(): React.JSX.Element {
  const [flags, setFlags] = useState<Record<FeatureFlagKey, boolean> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchFeatureFlags().then((loaded) => {
      if (mounted && loaded) setFlags(loaded);
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function handleToggle(key: FeatureFlagKey): Promise<void> {
    const current = flags;
    if (!current) return;
    const previous = current[key];
    const next = !previous;
    setFlags((prev) => (prev ? { ...prev, [key]: next } : prev));
    setError(null);

    const ok = await patchFeatureFlag(key, next);
    if (!ok) {
      setFlags((prev) => (prev ? { ...prev, [key]: previous } : prev));
      setError(SAVE_FAILED_MESSAGE);
    }
  }

  return (
    <section className="card mt-4">
      <h2 className="font-semibold">Functies</h2>
      {flags ? (
        FEATURE_TOGGLE_ROWS.map((row) => (
          <FeatureToggleRow
            key={row.key}
            label={row.label}
            enabled={flags[row.key]}
            onToggle={() => void handleToggle(row.key)}
          />
        ))
      ) : (
        <p className="muted mt-2 text-sm">Functies laden…</p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
