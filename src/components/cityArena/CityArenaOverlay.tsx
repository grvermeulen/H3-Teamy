"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactPortal,
  type RefObject,
} from "react";
import { createPortal, preload } from "react-dom";
import { ZONE_OPTIONS } from "@/lib/cityArena/constants";
import { ArenaPhaseScreens } from "./ArenaPhaseScreens";
import { ArenaSettingsSheet, MENU_LABEL } from "./ArenaSettingsSheet";
import { ArenaTouchTip } from "./ArenaTouchTip";
import type { ArenaLayout } from "@/lib/cityArena/schemas";
import {
  hasSeenArenaTouchTip,
  markArenaTouchTipSeen,
} from "@/lib/cityArena/storage";
import { ConnectionBanner } from "./ConnectionBanner";
import { HostToast } from "./HostToast";
import { useArenaRoom, type ArenaRoom } from "./useArenaRoom";
import type { ArenaEntry } from "./arenaEntry";
import { isDebugEnabled } from "@/lib/cityArena/debugFlag";
import {
  createStick,
  type StickController,
} from "@/lib/cityArena/input/touchStick";
import type { MapZone, ZoneKey } from "@/lib/cityArena/world/mapTypes";
import ArenaDebugOverlay from "./ArenaDebugOverlay";
import ArenaRadar from "./ArenaRadar";
import ArenaLoadingScreen, {
  ATTRIBUTION_TEXT,
  MAP_LOAD_FAILURE_TEXT,
} from "./ArenaLoadingScreen";
import ArenaTouchButtons from "./ArenaTouchButtons";
import ArenaVitals from "./ArenaVitals";
import ArenaSoundToggle from "./ArenaSoundToggle";
import ArenaWanted from "./ArenaWanted";
import ArenaZoneWarning from "./ArenaZoneWarning";
import DeathOverlay, { WASTED_WEBP } from "./DeathOverlay";
import TouchStick from "./TouchStick";
import {
  useArenaGame,
  type ArenaGame,
  type ArenaHud,
  type ArenaNetplayOptions,
} from "./useArenaGame";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

/** Media query matching phones and other coarse-pointer devices: shows the touch stick. */
const TOUCH_MEDIA_QUERY = "(max-width: 768px), (pointer: coarse)";
/** Media query of the user's reduced-motion preference (death screen beats, spec §7). */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Props for {@link CityArenaOverlay}. */
type CityArenaOverlayProps = { entry: ArenaEntry; onClose: () => void };

/**
 * The overlay draws whichever phase the match clock is in.
 *
 * That phase is deliberately separate from `ArenaPhase`, which is the *canvas* lifecycle
 * (loading, playing, error). Conflating "the map is still loading" with "we are in the lobby"
 * is how those two end up unable to express a lobby whose city is still loading behind it.
 */

/**
 * True while the viewport matches the touch-control media query (updates on resize/rotate), unless
 * the settings force a layout, in which case the setting decides.
 */
function useShowTouchControls(forceLayout: ArenaLayout | undefined): boolean {
  const [showTouch, setShowTouch] = useState(true);
  useEffect(() => {
    const query = window.matchMedia(TOUCH_MEDIA_QUERY);
    const apply = (): void => setShowTouch(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return forceLayout ? forceLayout === "mobile" : showTouch;
}

/** The first-run touch tip: shown once the touch controls are up, until it has been read. */
function useTouchTip(active: boolean): { shown: boolean; dismiss: () => void } {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (active && !hasSeenArenaTouchTip()) setShown(true);
  }, [active]);
  const dismiss = useCallback(() => {
    markArenaTouchTipSeen();
    setShown(false);
  }, []);
  return { shown, dismiss };
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

/** Warms the browser's cache for the death-screen artwork so it is ready before the first death. */
function useWarmDeathArtwork(): void {
  useEffect(() => {
    preload(WASTED_WEBP, { as: "image", type: "image/webp" });
  }, []);
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
  onSoundChange: (enabled: boolean) => void;
  onMenu: () => void;
  onClose: () => void;
};

/** Top strip: zone/street, vitals, an optional load warning, the zone picker, the menu and the close button. */
function ArenaHudBar({
  hud,
  zones,
  pickerDisabled,
  showLoadWarning,
  onTeleport,
  onSoundChange,
  onMenu,
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
        <ArenaWanted wantedLevel={hud.wantedLevel} />
        {hud.radioStation ? (
          <span className="muted truncate text-xs">
            {`Radio · ${hud.radioStation}`}
          </span>
        ) : null}
        {showLoadWarning ? (
          <span className="text-xs text-[#f0b429]">
            {MAP_LOAD_FAILURE_TEXT}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ArenaSoundToggle enabled={hud.soundEnabled} onChange={onSoundChange} />
        <ArenaZonePicker
          zones={zones}
          currentKey={hud.zoneKey ?? ""}
          disabled={pickerDisabled}
          onTeleport={onTeleport}
        />
        <button type="button" onClick={onMenu}>
          {MENU_LABEL}
        </button>
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
  aimStick: StickController;
  tip: { shown: boolean; dismiss: () => void };
};

/** Canvas plus the loading, error, stick, buttons, death and debug layers drawn on top of it. */
function ArenaPlayfield({
  canvasRef,
  game,
  debug,
  showTouch,
  reducedMotion,
  stick,
  aimStick,
  tip,
}: ArenaPlayfieldProps): React.JSX.Element {
  const playing = game.phase === "playing";
  const twinStick = game.settings.twinStick;
  return (
    <div className="relative min-h-0 flex-1">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none [@media(pointer:fine)]:cursor-none"
        aria-label="GTA H3 speelveld"
      />
      <ArenaRadar snapshot={game.radar} />
      <ArenaZoneWarning
        zoneWarning={game.hud.zoneWarning}
        secondsLeft={game.hud.zoneSecondsLeft}
      />
      {playing && showTouch ? (
        <TouchStick stick={stick} onVector={game.setInputVector} />
      ) : null}
      {playing && showTouch && twinStick ? (
        <TouchStick
          side="right"
          stick={aimStick}
          onVector={game.setAimVector}
        />
      ) : null}
      {playing && showTouch ? (
        <ArenaTouchButtons
          inVehicle={game.hud.inVehicle}
          onButton={game.setButton}
          showFire={!twinStick}
          onRadio={game.nextStation}
        />
      ) : null}
      {playing && showTouch && tip.shown ? (
        <ArenaTouchTip twinStick={twinStick} onDismiss={tip.dismiss} />
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
type ArenaFooterProps = { showTouch: boolean; twinStick: boolean };

/** The hint for each control scheme (spec §7). */
function controlsHint(showTouch: boolean, twinStick: boolean): string {
  if (!showTouch)
    return "WASD of pijltjes lopen of sturen · muis richt en schiet · E instappen · Q, wiel of 1-2-3 wapen · R radio · Tab scorebord · Esc menu.";
  return twinStick
    ? "Sleep links op het scherm om te lopen of te sturen; sleep rechts om te richten en te schieten."
    : "Sleep links op het scherm om te lopen of te sturen; rechts: Schieten, Instappen, Wapen.";
}

/** Bottom hint line: the active control scheme plus the OpenStreetMap attribution. */
function ArenaFooter({
  showTouch,
  twinStick,
}: ArenaFooterProps): React.JSX.Element {
  return (
    <p className="muted mx-2 my-1 shrink-0 text-center text-xs">
      <span>{controlsHint(showTouch, twinStick)}</span>{" "}
      <span>{ATTRIBUTION_TEXT}</span>
    </p>
  );
}

/** What the game needs from the room to run its loop. */
function netplayFor(room: ArenaRoom): ArenaNetplayOptions {
  return {
    transport: room.transport,
    ready: room.status === "ready",
    connected: room.connection === "connected",
    roomCode: room.roomCode,
    clientId: room.clientId,
    clockOffsetMs: room.clockOffsetMs,
    hostClientId: room.hostClientId,
    isHost: room.isHost,
    memberIds: room.crew.map((member) => member.clientId),
    onHostLost: room.reportHostLost,
  };
}

/** True when the URL carries `?debug=1` in a non-production build (read once on mount). */
function useDebugFlag(): boolean {
  const [debug] = useState(
    () =>
      typeof window !== "undefined" &&
      isDebugEnabled(window.location.search, process.env.NODE_ENV),
  );
  return debug;
}

/** Full-screen arena session: loading screen, canvas, HUD strip, touch controls, death screen, attribution. */
export default function CityArenaOverlay({
  entry,
  onClose,
}: CityArenaOverlayProps): ReactPortal | null {
  const fallbackZone = ZONE_OPTIONS[0]!.key;
  const room = useArenaRoom({ entry, fallbackZone });
  const zone = room.zone;
  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stick = useMemo(() => createStick(), []);
  const aimStick = useMemo(() => createStick(), []);
  const debug = useDebugFlag();
  const reducedMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scoreboardHeld, setScoreboardHeld] = useState(false);
  const game = useArenaGame({
    zoneKey: zone,
    canvasRef,
    debug,
    reducedMotion,
    netplay: netplayFor(room),
    keys: { onScoreboard: setScoreboardHeld, suspended: menuOpen },
  });
  const showTouch = useShowTouchControls(game.settings.forceLayout);
  const tip = useTouchTip(showTouch && game.phase === "playing");
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const leave = useCallback(() => {
    room.leave();
    onClose();
  }, [room, onClose]);
  // Escape opens the menu (spec §7); the menu's own trap closes it again, and "Sluiten" is the
  // way out of the overlay.
  // Stood down while the sheet is open: the sheet's own trap owns Tab and Escape until then.
  useDialogFocusTrap(dialogRef, openMenu, !menuOpen);
  useLockBodyScroll();
  useWarmDeathArtwork();

  const overlay = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="GTA H3"
      tabIndex={-1}
      className="arena arena-grid fixed inset-0 z-[3200] flex min-h-dvh flex-col touch-none select-none bg-[var(--arena-void)] pt-safe pb-safe-bottom-bar pl-safe pr-safe [-webkit-user-select:none] [-webkit-touch-callout:none]"
      onContextMenu={(event) => event.preventDefault()}
    >
      <ConnectionBanner state={room.connection} />
      <HostToast
        hostClientId={room.hostClientId}
        hostName={room.crew.find((member) => member.isHost)?.name ?? null}
      />
      <ArenaHudBar
        hud={game.hud}
        zones={game.zones}
        pickerDisabled={game.phase !== "playing"}
        showLoadWarning={game.phase === "playing" && game.failed}
        onTeleport={game.teleportToZone}
        onSoundChange={game.setSound}
        onMenu={openMenu}
        onClose={onClose}
      />
      <ArenaPlayfield
        canvasRef={canvasRef}
        game={game}
        debug={debug}
        showTouch={showTouch}
        reducedMotion={reducedMotion}
        stick={stick}
        aimStick={aimStick}
        tip={tip}
      />
      <ArenaFooter showTouch={showTouch} twinStick={game.settings.twinStick} />
      <ArenaPhaseScreens
        game={game}
        room={room}
        onClose={onClose}
        showScoreboard={scoreboardHeld}
      />
      {menuOpen ? (
        <ArenaSettingsSheet
          settings={game.settings}
          onChange={game.updateSettings}
          onLeave={leave}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
