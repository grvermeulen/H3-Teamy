"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { ZONE_OPTIONS } from "@/lib/cityArena/constants";
import { loadArenaSettings, saveArenaSettings } from "@/lib/cityArena/storage";
import type { ZoneKey } from "@/lib/cityArena/world/mapTypes";
import { useSession } from "../SessionContext";
import { ATTRIBUTION_TEXT } from "./ArenaLoadingScreen";
import { CityArenaLaunchIcon } from "./CityArenaLaunchIcon";

/** Same full-screen layer as the overlay itself, so the chunk load never flashes inline in the page. */
function ChunkLoadingOverlay(): React.JSX.Element | null {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[3200] flex items-center justify-center touch-none bg-[#0B1220] pt-safe pb-safe-bottom-bar pl-safe pr-safe"
    >
      <p className="muted p-4 text-center text-base">Spel laden…</p>
    </div>,
    document.body,
  );
}

const CityArenaOverlay = dynamic(
  () => import("./CityArenaOverlay").then((module) => module.default),
  { ssr: false, loading: () => <ChunkLoadingOverlay /> },
);

/** Icon, title and blurb shown at the top of the launcher card. */
function LauncherHeader(): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <CityArenaLaunchIcon size={52} decorative className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">GTA H3</div>
        <div className="muted mt-1 text-[13px]">
          Loop door Rhenen, Wageningen, de WUR-campus en Bennekom op de echte
          kaart — straten, gebouwen en herkenningspunten uit OpenStreetMap.
          Eerste versie: alleen rondlopen; auto&apos;s, tegenstanders en
          multiplayer volgen.
        </div>
      </div>
    </div>
  );
}

/** Props for {@link ZoneSelect}. */
type ZoneSelectProps = { zone: ZoneKey; onChange: (zone: ZoneKey) => void };

/** "Startpunt" dropdown: choose which zone to spawn into. */
function ZoneSelect({ zone, onChange }: ZoneSelectProps): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="muted text-xs">Startpunt</span>
      <select
        aria-label="Startpunt"
        className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-sm text-[#c9d1d9]"
        value={zone}
        onChange={(event) => {
          const chosen = ZONE_OPTIONS.find(
            (option) => option.key === event.target.value,
          );
          if (chosen) onChange(chosen.key);
        }}
      >
        {ZONE_OPTIONS.map((option) => (
          <option key={option.key} value={option.key}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Props for {@link PlayButton}. */
type PlayButtonProps = { onClick: () => void };

/** Opens the free-roam overlay at the chosen zone. */
function PlayButton({ onClick }: PlayButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center rounded-xl border border-cyan-500/50 bg-gradient-to-br from-cyan-900/95 via-[#0c1528] to-violet-900/95 px-4 py-2.5 text-sm font-semibold text-[#a5f3fc] shadow-[0_0_20px_-2px_rgba(34,211,238,0.55)] transition hover:border-cyan-400/70 active:scale-[0.98]"
    >
      Spelen
    </button>
  );
}

/** Login prompt shown to visitors who are not signed in. */
function LoginHint(): React.JSX.Element {
  return (
    <Link
      href={{ pathname: "/login", query: { callbackUrl: "/" } }}
      className="inline-flex items-center rounded-xl border border-white/15 bg-[#111926] px-3 py-2.5 text-sm font-medium text-[#c9d7ee]"
    >
      Log in om mee te doen
    </Link>
  );
}

/** Card under Space Invaders: pick a start zone and open the free-roam overlay. */
export default function CityArenaLauncher(): React.JSX.Element {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [zone, setZone] = useState<ZoneKey>(() => loadArenaSettings().lastZone);

  const openOverlay = useCallback(() => {
    saveArenaSettings({ lastZone: zone });
    setOpen(true);
  }, [zone]);
  const closeOverlay = useCallback(() => setOpen(false), []);

  return (
    <>
      <div className="card mt-4">
        <LauncherHeader />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <ZoneSelect zone={zone} onChange={setZone} />
          {session.loading ? null : session.loggedIn ? (
            <PlayButton onClick={openOverlay} />
          ) : (
            <LoginHint />
          )}
        </div>
        <p className="muted mt-3 text-xs">{ATTRIBUTION_TEXT}</p>
      </div>
      {open && session.loggedIn ? (
        <CityArenaOverlay zone={zone} onClose={closeOverlay} />
      ) : null}
    </>
  );
}
