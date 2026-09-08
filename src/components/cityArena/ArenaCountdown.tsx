"use client";

import { zoneName } from "./launcher/MissionCard";

/** Props for {@link ArenaCountdown}. */
export type ArenaCountdownProps = {
  /** 3, 2 or 1; the caller renders nothing once the countdown is over. */
  count: number;
  zone: string;
};

/**
 * The three seconds before a potje starts.
 *
 * Deliberately thin: the city is already drawn behind it and players are being teleported to
 * their spawns, so this is a veil over a live world rather than a screen of its own.
 *
 * @param props - The number to show and the zone being played.
 * @returns The countdown veil.
 */
export function ArenaCountdown({
  count,
  zone,
}: ArenaCountdownProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="assertive"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[rgba(7,9,11,0.72)]"
    >
      <span className="arena-label text-[var(--arena-online)]">
        {zoneName(zone)}
      </span>
      <span
        className="arena-display text-[96px] leading-none text-[var(--arena-amber)] drop-shadow-[0_0_30px_rgba(245,165,36,0.45)] sm:text-[140px]"
        aria-label={`Nog ${count}`}
      >
        {count}
      </span>
      <span className="arena-label text-[var(--arena-dim)]">Maak je klaar</span>
    </div>
  );
}
