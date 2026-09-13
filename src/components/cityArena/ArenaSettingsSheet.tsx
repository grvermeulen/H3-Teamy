"use client";

import { useRef } from "react";
import {
  RADIO_STATIONS,
  stationById,
} from "@/lib/cityArena/audio/radio/stations";
import type { ArenaLayout, ArenaSettings } from "@/lib/cityArena/schemas";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

/** Props for {@link ArenaSettingsSheet}. */
export type ArenaSettingsSheetProps = {
  children?: React.ReactNode;
  settings: ArenaSettings;
  onChange: (patch: Partial<ArenaSettings>) => void;
  /** "Potje verlaten": leaves the room and closes the overlay. */
  onLeave: () => void;
  /** Closes the sheet; the match, if any, has been running underneath the whole time. */
  onClose: () => void;
};

/** The sheet's Dutch copy (spec §7, §16). */
export const MENU_LABEL = "Menu";
export const SOUND_LABEL = "Geluid";
export const VIBRATE_LABEL = "Trillen";
export const RADIO_LABEL = "Radio";
export const STATION_LABEL = "Zender";
export const CONTROLS_LABEL = "Besturing";
export const SINGLE_STICK_LABEL = "Enkele stick";
export const LAYOUT_LABEL = "Indeling";
export const LEAVE_LABEL = "Potje verlaten";
export const RESUME_LABEL = "Verder spelen";

/** The layout choices, with `auto` standing for "let the device decide". */
const LAYOUT_OPTIONS: { value: ArenaLayout | "auto"; label: string }[] = [
  { value: "auto", label: "Automatisch" },
  { value: "mobile", label: "Telefoon" },
  { value: "desktop", label: "Computer" },
];

/** One labelled switch in the sheet. */
function SettingSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="flex min-h-[44px] items-center justify-between gap-4 border-b border-[var(--arena-line)] py-2 text-sm text-[var(--arena-text)]">
      <span>{label}</span>
      <input
        type="checkbox"
        aria-label={label}
        className="h-5 w-5 accent-[var(--arena-amber)]"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

/** The station picker, shown only when there is a dial to pick from. */
function StationSelect({
  settings,
  onChange,
}: Pick<ArenaSettingsSheetProps, "settings" | "onChange">): React.JSX.Element {
  return (
    <label className="flex min-h-[44px] items-center justify-between gap-4 border-b border-[var(--arena-line)] py-2 text-sm text-[var(--arena-text)]">
      <span>{STATION_LABEL}</span>
      <select
        aria-label={STATION_LABEL}
        className="rounded border border-[var(--arena-line-strong)] bg-[var(--arena-panel)] px-2 py-1 text-sm text-[var(--arena-text)]"
        value={stationById(settings.radioStation)?.id ?? ""}
        onChange={(event) => onChange({ radioStation: event.target.value })}
      >
        {RADIO_STATIONS.map((station) => (
          <option key={station.id} value={station.id}>
            {station.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The in-game menu (spec §7): Geluid, Trillen, Radio, Besturing and the way out. It pauses nothing —
 * a potje with other people in it cannot wait for one of them — so the city keeps running
 * behind the veil.
 *
 * @param props - The settings, how to change them, and the two ways out.
 * @returns The sheet.
 */
export function ArenaSettingsSheet({
  settings,
  onChange,
  onLeave,
  onClose,
  children,
}: ArenaSettingsSheetProps): React.JSX.Element {
  const sheetRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(sheetRef, onClose);
  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-[rgba(7,9,11,0.7)] p-3 sm:items-center">
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={MENU_LABEL}
        tabIndex={-1}
        className="arena-card max-h-[85dvh] w-full max-w-sm overflow-y-auto p-4"
      >
        <h2 className="arena-display mb-2 text-2xl text-[var(--arena-text)]">
          {MENU_LABEL}
        </h2>
        <SettingSwitch
          label={SOUND_LABEL}
          checked={settings.sound}
          onChange={(sound) => onChange({ sound })}
        />
        <SettingSwitch
          label={VIBRATE_LABEL}
          checked={settings.vibrate}
          onChange={(vibrate) => onChange({ vibrate })}
        />
        <SettingSwitch
          label={RADIO_LABEL}
          checked={settings.radio}
          onChange={(radio) => onChange({ radio })}
        />
        {RADIO_STATIONS.length > 0 ? (
          <StationSelect settings={settings} onChange={onChange} />
        ) : null}
        <label className="flex min-h-[44px] items-center justify-between gap-4 py-2 text-sm">
          <span>Beeldkwaliteit</span>
          <select
            aria-label="Beeldkwaliteit"
            className="min-h-11 rounded border border-[var(--arena-line)] bg-[var(--arena-panel)] px-2"
            value={settings.quality}
            onChange={(event) =>
              onChange({
                quality: event.target.value as ArenaSettings["quality"],
              })
            }
          >
            <option value="auto">Automatisch</option>
            <option value="low">Zuinig</option>
            <option value="high">Hoog</option>
          </select>
        </label>
        <p className="arena-label mt-3 text-[var(--arena-dim)]">
          {CONTROLS_LABEL}
        </p>
        <SettingSwitch
          label={SINGLE_STICK_LABEL}
          checked={!settings.twinStick}
          onChange={(single) => onChange({ twinStick: !single })}
        />
        <label className="flex min-h-[44px] items-center justify-between gap-4 py-2 text-sm text-[var(--arena-text)]">
          <span>{LAYOUT_LABEL}</span>
          <select
            aria-label={LAYOUT_LABEL}
            className="rounded border border-[var(--arena-line-strong)] bg-[var(--arena-panel)] px-2 py-1 text-sm text-[var(--arena-text)]"
            value={settings.forceLayout ?? "auto"}
            onChange={(event) =>
              onChange({
                forceLayout:
                  event.target.value === "auto"
                    ? undefined
                    : (event.target.value as ArenaLayout),
              })
            }
          >
            {LAYOUT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {children}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onLeave}
            className="arena-label border border-transparent px-3 py-2.5 text-[var(--arena-dim)] transition hover:text-[var(--arena-alert)]"
          >
            {LEAVE_LABEL}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="arena-label bg-[var(--arena-amber)] px-5 py-3 text-[var(--arena-void)] transition hover:brightness-110 active:scale-[0.99]"
          >
            {RESUME_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}
