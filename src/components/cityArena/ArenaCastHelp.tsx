"use client";

import { useEffect, useState } from "react";
import {
  ARENA_CAST_HELP,
  ARENA_CAST_DEVICES,
  arenaCastDevice,
  type ArenaCastDevice,
} from "@/lib/cityArena/castHelp";

/** Cast or screen-mirroring symbol; its adjacent text supplies the accessible label. */
export function ArenaCastIcon({
  mirror = false,
}: {
  mirror?: boolean;
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-7 w-7 shrink-0"
    >
      {mirror ? (
        <>
          <rect x="2" y="8" width="14" height="12" rx="2" />
          <path d="M8 8V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4" />
        </>
      ) : (
        <>
          <path d="M3 8V5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-7M2 12a10 10 0 0 1 10 10M2 17a5 5 0 0 1 5 5" />
          <circle cx="2" cy="22" r="1" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

/** Mirroring steps inside the active game's menu, without navigating away or restarting it. */
export function ArenaCastHelp({
  onBack,
  onResume,
}: {
  onBack: () => void;
  onResume: () => void;
}): React.JSX.Element {
  const [device, setDevice] = useState<ArenaCastDevice>("iphone");
  useEffect(() => setDevice(arenaCastDevice(navigator)), []);
  const help = ARENA_CAST_HELP[device];
  return (
    <div className="space-y-4 text-sm text-[var(--arena-text)]">
      <p className="text-[var(--arena-dim)]">
        Start schermspiegeling via je apparaat of browser. Je huidige potje
        blijft open.
      </p>
      <fieldset>
        <legend className="mb-2 text-[var(--arena-dim)]">Ik speel op</legend>
        <div className="flex flex-wrap gap-2">
          {ARENA_CAST_DEVICES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={device === option}
              onClick={() => setDevice(option)}
              className="min-h-11 rounded border border-[var(--arena-line)] px-3 aria-pressed:border-[var(--arena-amber)] aria-pressed:bg-[var(--arena-amber)] aria-pressed:text-[var(--arena-void)]"
            >
              {ARENA_CAST_HELP[option].label}
            </button>
          ))}
        </div>
      </fieldset>
      <h3 className="font-semibold">{help.title}</h3>
      {device === "iphone" ? (
        <div className="flex items-center gap-3 rounded border border-[var(--arena-amber)] p-3 text-[var(--arena-amber)]">
          <ArenaCastIcon mirror />
          <div>
            <p className="font-semibold">Synchrone weergave</p>
            <p className="text-xs">
              Deze knop vind je in het bedieningspaneel.
            </p>
          </div>
        </div>
      ) : null}
      <ol className="list-decimal space-y-3 pl-5 leading-relaxed">
        {help.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="rounded bg-[var(--arena-panel)] p-3 leading-relaxed text-[var(--arena-dim)]">
        {help.note}
      </p>
      <a
        href={help.helpUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center underline"
      >
        Uitleg met afbeeldingen ↗
      </a>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--arena-line)] pt-4">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 px-2 underline"
        >
          Terug naar menu
        </button>
        <button
          type="button"
          onClick={onResume}
          className="min-h-11 rounded bg-[var(--arena-amber)] px-4 font-semibold text-[var(--arena-void)]"
        >
          Verder spelen
        </button>
      </div>
    </div>
  );
}
