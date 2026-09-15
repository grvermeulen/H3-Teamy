"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ZONE_OPTIONS } from "@/lib/cityArena/constants";
import { DEFAULT_ARENA_SETTINGS } from "@/lib/cityArena/schemas";
import { loadArenaSettings, saveArenaSettings } from "@/lib/cityArena/storage";
import type { ZoneKey } from "@/lib/cityArena/world/mapTypes";

interface ArenaNewGameProps {
  onStart: (zone: ZoneKey) => void;
  onCancel?: () => void;
  disabled?: boolean;
  focusOnOpen?: boolean;
}

const LOCATION_HINTS: Record<ZoneKey, string> = {
  rhenen: "Cunerakerk en zwembad ’t Gastland",
  wageningen: "Grote Kerk en Café Onder de Linden",
  campus: "Forum, Orion en Atlas",
  bennekom: "Oude Kerk en zwembad De Vrije Slag",
};

/** Lets players choose and confirm a remembered starting location before a room is created. */
export function ArenaNewGame({
  onStart,
  onCancel,
  disabled = false,
  focusOnOpen = false,
}: ArenaNewGameProps): React.JSX.Element {
  const [zone, setZone] = useState<ZoneKey>(DEFAULT_ARENA_SETTINGS.lastZone);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    setZone(loadArenaSettings().lastZone);
    if (focusOnOpen) heading.current?.focus();
  }, [focusOnOpen]);
  return (
    <form
      className="mt-4 rounded border border-[var(--arena-line-strong)] bg-[var(--arena-panel)] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        saveArenaSettings({ lastZone: zone });
        onStart(zone);
      }}
    >
      <h3
        ref={heading}
        tabIndex={-1}
        className="arena-display text-xl text-[var(--arena-text)]"
      >
        Waar wil je beginnen?
      </h3>
      <p className="mt-1 text-sm text-[var(--arena-dim)]">
        Kies de startlocatie voor je nieuwe potje. Iedereen in de kamer begint
        hier.
      </p>
      <LocationOptions zone={zone} onChange={setZone} disabled={disabled} />
      <NewGameActions zone={zone} disabled={disabled} onCancel={onCancel} />
    </form>
  );
}

interface LocationOptionsProps {
  zone: ZoneKey;
  onChange: (zone: ZoneKey) => void;
  disabled: boolean;
}

/** Four named places with native radio keyboard navigation. */
function LocationOptions({
  zone,
  onChange,
  disabled,
}: LocationOptionsProps): React.JSX.Element {
  const groupId = useId();
  return (
    <fieldset className="mt-3 grid gap-2 sm:grid-cols-2" disabled={disabled}>
      <legend className="sr-only">Startlocatie</legend>
      {ZONE_OPTIONS.map((option) => (
        <label
          key={option.key}
          className="flex min-h-16 cursor-pointer items-start gap-3 rounded border border-[var(--arena-line-strong)] p-3 text-[var(--arena-text)] has-[:checked]:border-[var(--arena-amber)] has-[:checked]:bg-[var(--arena-panel-raised)]"
        >
          <input
            type="radio"
            name={groupId}
            value={option.key}
            checked={zone === option.key}
            onChange={() => onChange(option.key)}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--arena-amber)]"
          />
          <span>
            <span className="block text-sm font-semibold">{option.name}</span>
            <span className="mt-1 block text-xs text-[var(--arena-dim)]">
              {LOCATION_HINTS[option.key]}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

interface NewGameActionsProps {
  zone: ZoneKey;
  disabled: boolean;
  onCancel?: () => void;
}

/** Confirms the named location or returns to the launcher. */
function NewGameActions({
  zone,
  disabled,
  onCancel,
}: NewGameActionsProps): React.JSX.Element {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="submit"
        disabled={disabled}
        className="min-h-12 rounded bg-[var(--arena-amber)] px-4 py-3 text-sm font-semibold text-[var(--arena-void)] disabled:opacity-40"
      >
        Potje openen in{" "}
        {ZONE_OPTIONS.find((option) => option.key === zone)!.name}
      </button>
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="min-h-12 px-3 text-sm text-[var(--arena-dim)]"
        >
          Annuleren
        </button>
      ) : null}
    </div>
  );
}
