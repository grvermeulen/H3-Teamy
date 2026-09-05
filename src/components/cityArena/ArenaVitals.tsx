"use client";

import { PLAYER_MAX_HEALTH } from "@/lib/cityArena/sim/damage";
import type { AmmoState, WeaponKind } from "@/lib/cityArena/sim/types";
import { ammoFor, weaponLabel } from "@/lib/cityArena/sim/weapons";

/** Accessible name of the health bar (spec §16). */
export const HEALTH_LABEL = "Gezondheid";
/** Shown instead of a count for unlimited weapons. */
const UNLIMITED_AMMO = "∞";
/** Health at or below which the bar turns red and pulses (spec §7: low-health throb below 25). */
const LOW_HEALTH = 25;
/** Metres per second to kilometres per hour. */
const KMH_PER_MPS = 3.6;
/** Bar classes shared by both colours. */
const BAR_BASE_CLASS =
  "h-2 w-24 overflow-hidden rounded [&::-webkit-progress-bar]:bg-white/15";
/** Bar classes when healthy. */
const BAR_OK_CLASS =
  "[&::-moz-progress-bar]:bg-[#22c55e] [&::-webkit-progress-value]:bg-[#22c55e]";
/** Bar classes when low: red and pulsing. */
const BAR_LOW_CLASS =
  "animate-pulse [&::-moz-progress-bar]:bg-[#e11d48] [&::-webkit-progress-value]:bg-[#e11d48]";

/** Props for {@link ArenaVitals}. */
export type ArenaVitalsProps = {
  health: number;
  weapon: WeaponKind;
  ammo: AmmoState;
  speedMps: number | null;
};

/** Health bar, weapon with ammo, and the speed while driving (`speedMps` is `null` on foot). */
export default function ArenaVitals({
  health,
  weapon,
  ammo,
  speedMps,
}: ArenaVitalsProps): React.JSX.Element {
  const rounds = ammoFor(ammo, weapon);
  const barClass = `${BAR_BASE_CLASS} ${health <= LOW_HEALTH ? BAR_LOW_CLASS : BAR_OK_CLASS}`;
  return (
    <div
      data-testid="arena-vitals"
      className="flex items-center gap-3 text-sm text-[#c9d1d9]"
    >
      <progress
        aria-label={HEALTH_LABEL}
        value={health}
        max={PLAYER_MAX_HEALTH}
        className={barClass}
      />
      <span data-testid="arena-weapon" className="font-semibold">
        {weaponLabel(weapon)}{" "}
        <span className="muted">
          {rounds === null ? UNLIMITED_AMMO : rounds}
        </span>
      </span>
      {speedMps === null ? null : (
        <span data-testid="arena-speed">
          {Math.round(speedMps * KMH_PER_MPS)} km/u
        </span>
      )}
    </div>
  );
}
