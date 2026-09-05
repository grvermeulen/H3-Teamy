"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactPortal,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { isDebugEnabled } from "@/lib/cityArena/debugFlag";
import {
  createStick,
  type StickController,
} from "@/lib/cityArena/input/touchStick";
import type { MapZone, ZoneKey } from "@/lib/cityArena/world/mapTypes";
import ArenaDebugOverlay from "./ArenaDebugOverlay";
import ArenaLoadingScreen, {
  ATTRIBUTION_TEXT,
  MAP_LOAD_FAILURE_TEXT,
} from "./ArenaLoadingScreen";
import ArenaTouchButtons from "./ArenaTouchButtons";
import ArenaVitals from "./ArenaVitals";
import DeathOverlay from "./DeathOverlay";
import TouchStick from "./TouchStick";
import { useArenaGame, type ArenaGame, type ArenaHud } from "./useArenaGame";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

/** Media query matching phones and other coarse-pointer devices: shows the touch stick. */
const TOUCH_MEDIA_QUERY = "(max-width: 768px), (pointer: coarse)";
/** Media query of the user's reduced-motion preference (death screen beats, spec §7). */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Props for {@link CityArenaOverlay}. */
type CityArenaOverlayProps = { zone: ZoneKey; onClose: () => void };

/** True while the viewport matches the touch-control media query; updates on resize/rotate. */
function useShowTouchControls(): boolean {
  const [showTouch, setShowTouch] = useState(true);
  useEffect(() => {
    const query = window.matchMedia(TOUCH_MEDIA_QUERY);
    const apply = (): void => setShowTouch(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return showTouch;
}

/**
 * True while the user prefers reduced motion; updates when the preference changes. Some jsdom
 * test environments (and old browsers) leave `window.matchMedia` unimplemented, so this stays
 * `false` and subscribes to nothing rather than throwing when it is not a function.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const apply = (): void => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/** Locks page scroll behind the full-screen overlay for as long as it is mounted. */
function useLockBodyScroll(): void {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);
}

/** Props for {@link ArenaZonePicker}. */
type ArenaZonePickerProps = {
  zones: MapZone[];
  currentKey: string;
  disabled: boolean;
  onTeleport: (key: ZoneKey) => void;
};

/** The "Ga naar" select that teleports the player into another zone. */
function ArenaZonePicker({
  zones,
  currentKey,
  disabled,
  onTeleport,
}: ArenaZonePickerProps): React.JSX.Element {
  return (
    <label className="flex items-center gap-1 text-xs">
      <span>Ga naar</span>
      <select
        aria-label="Ga naar"
        className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-sm text-[#c9d1d9]"
        value={currentKey}
        disabled={disabled}
        onChange={(event) => {
          const chosen = zones.find(
            (candidate) => candidate.key === event.target.value,
          );
          if (chosen) onTeleport(chosen.key);
        }}
      >
        <option value="">Kies…</option>
        {zones.map((candidate) => (
          <option key={candidate.key} value={candidate.key}>
            {candidate.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Props for {@link ArenaHudBar}. */
type ArenaHudBarProps = {
  hud: ArenaHud;
  zones: MapZone[];
  pickerDisabled: boolean;
  showLoadWarning: boolean;
  onTeleport: (key: ZoneKey) => void;
  onClose: () => void;
};

/** Top strip: zone/street, vitals, an optional load warning, the zone picker and the close button. */
function ArenaHudBar({
  hud,
  zones,
  pickerDisabled,
  showLoadWarning,
  onTeleport,
  onClose,
}: ArenaHudBarProps): React.JSX.Element {
  return (
    <div
      data-testid="arena-hud"
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#21262d] px-3 py-2 text-sm text-[#c9d1d9]"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <span className="font-semibold">
          {hud.zoneName ?? "Vrij rondlopen"}
        </span>
        {hud.street ? (
          <span className="muted truncate">{hud.street}</span>
        ) : null}
        <ArenaVitals
          health={hud.health}
          weapon={hud.weapon}
          ammo={hud.ammo}
          speedMps={hud.speedMps}
        />
        {showLoadWarning ? (
          <span className="text-xs text-[#f0b429]">
            {MAP_LOAD_FAILURE_TEXT}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ArenaZonePicker
          zones={zones}
          currentKey={hud.zoneKey ?? ""}
          disabled={pickerDisabled}
          onTeleport={onTeleport}
        />
        <button type="button" onClick={onClose}>
          Sluiten
        </button>
      </div>
    </div>
  );
}

/** Full-screen Dutch error message shown when the world fails to boot. */
function ArenaErrorMessage(): React.JSX.Element {
  return (
    <div
      role="alert"
      className="absolute inset-0 flex items-center justify-center p-6 text-center text-[#c9d1d9]"
    >
      Kon geen verbinding maken, probeer het later opnieuw
    </div>
  );
}

/** Props for {@link ArenaPlayfield}. */
type ArenaPlayfieldProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  game: ArenaGame;
  debug: boolean;
  showTouch: boolean;
  reducedMotion: boolean;
  stick: StickController;
};

/** Canvas plus the loading, error, stick, buttons, death and debug layers drawn on top of it. */
function ArenaPlayfield({
  canvasRef,
  game,
  debug,
  showTouch,
  reducedMotion,
  stick,
}: ArenaPlayfieldProps): React.JSX.Element {
  const playing = game.phase === "playing";
  return (
    <div className="relative min-h-0 flex-1">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none [@media(pointer:fine)]:cursor-none"
        aria-label="GTA H3 speelveld"
      />
      {playing && showTouch ? (
        <TouchStick stick={stick} onVector={game.setInputVector} />
      ) : null}
      {playing && showTouch ? (
        <ArenaTouchButtons
          inVehicle={game.hud.inVehicle}
          onButton={game.setButton}
        />
      ) : null}
      {game.phase === "loading" ? (
        <ArenaLoadingScreen
          loaded={game.progress.loaded}
          total={game.progress.total}
          failed={game.failed}
        />
      ) : null}
      {game.phase === "error" ? <ArenaErrorMessage /> : null}
      {playing && game.death ? (
        <DeathOverlay
          diedAtMs={game.death.diedAtMs}
          reducedMotion={reducedMotion}
        />
      ) : null}
      {debug && game.debugSnapshot ? (
        <ArenaDebugOverlay {...game.debugSnapshot} />
      ) : null}
    </div>
  );
}

/** Props for {@link ArenaFooter}. */
type ArenaFooterProps = { showTouch: boolean };

/** Bottom hint line: the active control scheme plus the OpenStreetMap attribution. */
function ArenaFooter({ showTouch }: ArenaFooterProps): React.JSX.Element {
  return (
    <p className="muted mx-2 my-1 shrink-0 text-center text-xs">
      <span>
        {showTouch
          ? "Sleep links op het scherm om te lopen of te sturen; rechts: Schieten, Instappen, Wapen."
          : "WASD of pijltjes lopen of sturen · muis richt en schiet · E instappen · Q wapen · Esc sluit."}
      </span>{" "}
      <span>{ATTRIBUTION_TEXT}</span>
    </p>
  );
}

/** Full-screen arena session: loading screen, canvas, HUD strip, touch controls, death screen, attribution. */
/** True when the URL carries `?debug=1` in a non-production build (read once on mount). */
function useDebugFlag(): boolean {
  const [debug] = useState(
    () =>
      typeof window !== "undefined" &&
      isDebugEnabled(window.location.search, process.env.NODE_ENV),
  );
  return debug;
}

export default function CityArenaOverlay({
  zone,
  onClose,
}: CityArenaOverlayProps): ReactPortal | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stick = useMemo(() => createStick(), []);
  const debug = useDebugFlag();
  const showTouch = useShowTouchControls();
  const reducedMotion = useReducedMotion();
  const game = useArenaGame({ zoneKey: zone, canvasRef, debug, reducedMotion });
  useDialogFocusTrap(dialogRef, onClose);
  useLockBodyScroll();

  const overlay = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="GTA H3"
      tabIndex={-1}
      className="fixed inset-0 z-[3200] flex min-h-dvh flex-col touch-none select-none bg-[#0B1220] pt-safe pb-safe-bottom-bar pl-safe pr-safe [-webkit-user-select:none] [-webkit-touch-callout:none]"
      onContextMenu={(event) => event.preventDefault()}
    >
      <ArenaHudBar
        hud={game.hud}
        zones={game.zones}
        pickerDisabled={game.phase !== "playing"}
        showLoadWarning={game.phase === "playing" && game.failed}
        onTeleport={game.teleportToZone}
        onClose={onClose}
      />
      <ArenaPlayfield
        canvasRef={canvasRef}
        game={game}
        debug={debug}
        showTouch={showTouch}
        reducedMotion={reducedMotion}
        stick={stick}
      />
      <ArenaFooter showTouch={showTouch} />
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
