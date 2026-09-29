"use client";

import {
  TOUCH_LOOK_SENSITIVITY_MAX,
  TOUCH_LOOK_SENSITIVITY_MIN,
} from "@/lib/cityArena/schemas";

/** The slider's label in the menu (aim round §6). */
export const LOOK_SENSITIVITY_LABEL = "Kijkgevoeligheid";
/** The slider moves in steps of this factor. */
const SENSITIVITY_STEP = 0.05;
/** A factor as the menu shows it: Dutch decimals, two places, and a times sign ("1,25×"). */
const FACTOR_FORMAT = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Props for {@link ArenaLookSensitivity}. */
export type ArenaLookSensitivityProps = {
  /** The `touchLookSensitivity` setting. */
  value: number;
  onChange: (value: number) => void;
};

/**
 * "Kijkgevoeligheid" in the menu on touch devices (aim round §6): how far a drag on the 3D look
 * pad turns the camera, 0,25× to 2,5×.
 *
 * @param props - The setting and how to change it.
 * @returns The labelled slider.
 */
export function ArenaLookSensitivity({
  value,
  onChange,
}: ArenaLookSensitivityProps): React.JSX.Element {
  return (
    <label className="flex min-h-[44px] items-center justify-between gap-4 border-b border-[var(--arena-line)] py-2 text-sm text-[var(--arena-text)]">
      <span>{LOOK_SENSITIVITY_LABEL}</span>
      <span className="flex items-center gap-2">
        <input
          type="range"
          aria-label={LOOK_SENSITIVITY_LABEL}
          min={TOUCH_LOOK_SENSITIVITY_MIN}
          max={TOUCH_LOOK_SENSITIVITY_MAX}
          step={SENSITIVITY_STEP}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-28 accent-[var(--arena-amber)]"
        />
        <output className="w-12 text-right tabular-nums">
          {FACTOR_FORMAT.format(value)}×
        </output>
      </span>
    </label>
  );
}
