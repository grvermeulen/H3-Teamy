"use client";

import { MOUSE_SENSITIVITY } from "@/lib/cityArena/schemas";

/** "Muisgevoeligheid": how fast the mouse turns the 3D view, as a multiple (aim spec §5). */
export const MOUSE_SENSITIVITY_LABEL = "Muisgevoeligheid";

/** A factor as the menu shows it: Dutch decimals, two places, and a times sign ("1,50×"). */
const FACTOR_FORMAT = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Props for {@link ArenaMouseSensitivity}. */
export type ArenaMouseSensitivityProps = {
  /** The `mouseSensitivity` setting. */
  value: number;
  /** True outside 3D, where the mouse does not turn a view. */
  disabled: boolean;
  onChange: (value: number) => void;
};

/**
 * The "Muisgevoeligheid" slider in the menu (aim spec §5), live only in 3D: mouse-look's turn per
 * pixel as a multiple, 0,25× to 2,5×.
 *
 * @param props - The setting, whether it applies, and how to change it.
 * @returns The labelled slider.
 */
export function ArenaMouseSensitivity({
  value,
  disabled,
  onChange,
}: ArenaMouseSensitivityProps): React.JSX.Element {
  return (
    <label className="flex min-h-[44px] items-center justify-between gap-4 border-b border-[var(--arena-line)] py-2 text-sm text-[var(--arena-text)]">
      <span>{MOUSE_SENSITIVITY_LABEL}</span>
      <span className="flex items-center gap-2">
        <input
          type="range"
          aria-label={MOUSE_SENSITIVITY_LABEL}
          min={MOUSE_SENSITIVITY.min}
          max={MOUSE_SENSITIVITY.max}
          step={MOUSE_SENSITIVITY.step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-28 accent-[var(--arena-amber)] disabled:opacity-40"
        />
        <span className="w-12 text-right tabular-nums">
          {FACTOR_FORMAT.format(value)}×
        </span>
      </span>
    </label>
  );
}
