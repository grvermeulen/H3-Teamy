"use client";

import type { ConnectionState } from "@/lib/cityArena/net/transport";

/** Props for {@link ConnectionBanner}. */
export type ConnectionBannerProps = { state: ConnectionState };

/** The Dutch copy for each connection state (spec §16). */
const COPY: Record<Exclude<ConnectionState, "connected">, string> = {
  connecting: "Verbinden…",
  suspended: "Verbinding verbroken… opnieuw verbinden",
  failed: "Kon geen verbinding maken, probeer het later opnieuw",
};

/**
 * The connection strip.
 *
 * Renders nothing while connected: a banner that is always on screen stops being read, and a
 * healthy connection is the state a player spends nearly all their time in.
 *
 * @param props - The current connection state.
 * @returns The banner, or nothing when connected.
 */
export function ConnectionBanner({
  state,
}: ConnectionBannerProps): React.JSX.Element | null {
  if (state === "connected") return null;
  const failed = state === "failed";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`arena-label border-b px-3 py-2 text-center ${
        failed
          ? "border-[var(--arena-alert)] bg-[rgba(255,107,107,0.14)] text-[var(--arena-alert)]"
          : "border-[var(--arena-amber)] bg-[var(--arena-amber-dim)] text-[var(--arena-amber)]"
      }`}
    >
      {COPY[state]}
    </div>
  );
}

/** Props for {@link ConnectionDot}. */
export type ConnectionDotProps = { state: ConnectionState };

/** The compact "● VERBONDEN" indicator for the lobby's top-right corner. */
export function ConnectionDot({
  state,
}: ConnectionDotProps): React.JSX.Element {
  const connected = state === "connected";
  return (
    <span
      className={`arena-label inline-flex items-center gap-1.5 ${
        connected ? "text-[var(--arena-online)]" : "text-[var(--arena-dim)]"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          connected
            ? "bg-[var(--arena-online)]"
            : "arena-pulse bg-[var(--arena-dim)]"
        }`}
      />
      {connected ? "Verbonden" : "Verbinden…"}
    </span>
  );
}
