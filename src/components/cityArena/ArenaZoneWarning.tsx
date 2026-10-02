"use client";

import { zoneWarningText } from "./arenaHud";

/** Props for the out-of-zone warning. */
export type ArenaZoneWarningProps = {
  zoneWarning: boolean;
  secondsLeft: number | null;
};

/** Live Dutch warning shown only while the player is outside an enforced zone. */
export default function ArenaZoneWarning({
  zoneWarning,
  secondsLeft,
}: ArenaZoneWarningProps): React.JSX.Element | null {
  if (!zoneWarning) return null;
  return (
    <div
      data-testid="arena-zone-warning"
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 top-3 text-center text-sm font-bold text-[#f0b429]"
    >
      {zoneWarningText(secondsLeft)}
    </div>
  );
}
