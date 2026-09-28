"use client";
import { useArenaMissionSave } from "./useArenaMissionSave";

import { replacePlayer } from "@/lib/cityArena/sim/players";
import type { MissionCommand } from "@/lib/cityArena/missions/types";
import { missionMapMarkers } from "@/lib/cityArena/missions/hud";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  createFrameMetrics,
  type FrameMetrics,
} from "@/lib/cityArena/debugMetrics";
import {
  createInputState,
  type ButtonName,
  type InputState,
} from "@/lib/cityArena/input/inputState";
import { attachKeyboard, attachWheel } from "@/lib/cityArena/input/keyboard";
import { aimFromVector } from "@/lib/cityArena/input/touchStick";
import {
  SLOT_WEAPONS,
  type WeaponSlot,
} from "@/lib/cityArena/input/weaponSelect";
import {
  attachPointerAim,
  type PointerAim,
} from "@/lib/cityArena/input/pointerAim";
import { zoomLevelForViewport } from "@/lib/cityArena/render/camera";
import {
  EMPTY_RADAR_SNAPSHOT,
  type RadarSnapshot,
} from "@/lib/cityArena/render/radar";
import { createBrowserArenaSession } from "@/lib/cityArena/world/browserSession";
import { rasterBudgetForViewport } from "@/lib/cityArena/render/staticRaster";
import { PLAYER_MAX_HEALTH, damagePlayer } from "@/lib/cityArena/sim/damage";
import { addHeat } from "@/lib/cityArena/sim/wanted";
import { createInput } from "@/lib/cityArena/sim/types";
import { SPAWN_AMMO } from "@/lib/cityArena/sim/weapons";
import {
  installArenaHooks,
  type ArenaTestHooks,
} from "@/lib/cityArena/test/hooks";
import { type LoadProgress } from "@/lib/cityArena/world/mapLoader";
import type {
  MapIndex,
  MapZone,
  ZoneKey,
} from "@/lib/cityArena/world/mapTypes";
import type { Point } from "@/lib/cityArena/world/projection";
import type { NavigationMapData } from "@/lib/cityArena/render/navigationMap";
import { type WorldSession } from "@/lib/cityArena/world/worldSession";
import { findZoneByKey } from "@/lib/cityArena/world/zone";
import type { ArenaSettings } from "@/lib/cityArena/schemas";
import { loadArenaSettings, saveArenaSettings } from "@/lib/cityArena/storage";
import { computeHud, type ArenaHud } from "./arenaHud";
import { useMatchSeam, type MatchPeek, type MatchSeam } from "./matchSeam";
import { useNetplay, type ArenaNetplayOptions } from "./useNetplay";
import { useView3d, type View3dControls } from "./view3d/useView3d";
import {
  aimAngle,
  applyTeleport,
  createRuntime,
  hudRadioStation,
  myPlayer,
  nearestLandmarkTo,
  reportArenaError,
  startFrameLoop,
  type DeathInfo,
  type DebugSnapshot,
  type FrameLoopOptions,
  type Runtime,
} from "./arenaRuntime";

/**
 * Re-exported from `arenaRuntime.ts` (their new home after the runtime/frame-loop layer was
 * split out) so `CityArenaOverlay.tsx` and this hook's tests keep their existing imports.
 */
export { aimAngle, computeHud, nearestLandmarkTo };
export type { ArenaHud, DebugSnapshot, DeathInfo };
export type { ArenaNetplayOptions, MatchPeek };

/** Fallback viewport width (CSS px) for the initial zoom, before the canvas has been laid out. */
const DEFAULT_VIEWPORT_WIDTH_PX = 390;

/** Overlay lifecycle phase. */
export type ArenaPhase = "loading" | "playing" | "error";
/** Load progress before the first tile arrives. */
const NO_PROGRESS: LoadProgress = { loaded: 0, total: 0 };
/** HUD state before the first refresh runs. */
const INITIAL_HUD: ArenaHud = {
  zoneName: null,
  zoneKey: null,
  street: null,
  health: PLAYER_MAX_HEALTH,
  weapon: "pistol",
  ammo: SPAWN_AMMO,
  speedMps: null,
  inVehicle: false,
  wantedLevel: 0,
  zoneSecondsLeft: null,
  zoneWarning: false,
  soundEnabled: true,
  radioStation: null,
  drunk: 0,
  canOrderBeer: false,
};
/** Hook options. */
export type UseArenaGameOptions = {
  zoneKey: ZoneKey;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  debug: boolean;
  reducedMotion?: boolean;
  /** The room to play in; omitted for offline free roam. */
  netplay?: ArenaNetplayOptions;
  /** What the keyboard says beyond movement, and whether a menu owns it right now. */
  keys?: ArenaKeyOptions;
  /** Controller members followed by the mirrored composite renderer. */
  sharedScreen?: { clientId: string; name: string }[];
};

/** The overlay's side of the keyboard (spec §7). */
export type ArenaKeyOptions = {
  /** Tab held shows the scorebord. */
  onScoreboard?: (held: boolean) => void;
  /** True while the menu is open: game keys are ignored and anything held is released. */
  suspended?: boolean;
  /** The player let go of the 3D pointer lock (the browser's first Esc): open the menu. */
  onPause?: () => void;
};
/** Hook result consumed by the overlay. */
export type ArenaGame = MatchSeam & {
  missionAction(command: Omit<MissionCommand, "sequence">): void;
  phase: ArenaPhase;
  progress: LoadProgress;
  failed: boolean;
  hud: ArenaHud;
  zones: MapZone[];
  death: DeathInfo | null;
  radar: RadarSnapshot;
  /** Reads loaded streets and places when opening the full-screen map. */
  navigationMap(): NavigationMapData | null;
  /** Selects a road destination, or clears navigation with null. */
  setDestination(point: Point | null): void;
  setSound(enabled: boolean): void;
  /** The player's settings, as persisted. */
  settings: ArenaSettings;
  /** Applies and persists a change to the settings. */
  updateSettings(patch: Partial<ArenaSettings>): void;
  setInputVector(vector: [number, number] | null): void;
  /** The aim stick: a pushed stick aims and fires, a released one stops (spec §7). */
  setAimVector(vector: [number, number] | null): void;
  setButton(name: ButtonName, pressed: boolean): void;
  /** Picks a weapon directly, as 1, 2 and 3 do. */
  selectWeapon(slot: WeaponSlot): void;
  /** Moves to the next weapon once, as the wheel does. */
  cycleWeapon(): void;
  /** Switches the radio to the next station, as R and the Radio button do. */
  nextStation(): void;
  /** Skips the current radio song within its station. */
  nextRadioTrack(): void;
  teleportToZone(key: ZoneKey): void;
  debugSnapshot: DebugSnapshot | null;
  /** The 3D view's WebGL canvas ref, failure toast and pointer-lock state. */
  view3d: View3dControls;
};

/**
 * Creates the map loader and world session. A tile failure is only surfaced via `onFailed` — the
 * loader itself already reports the error to Sentry (see `mapLoader.ts`'s `recordTileFailure`),
 * so the hook must not report it again under a second, high-cardinality tag.
 */
function createArenaSession(
  onFailed: () => void,
  rasterBudgetBytes: number | undefined,
): WorldSession {
  return createBrowserArenaSession(onFailed, rasterBudgetBytes, true);
}

/** Raster budget sized to the canvas's current layout box, or `undefined` before it has one. */
function rasterBudgetForCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
): number | undefined {
  const rect = canvasRef.current?.getBoundingClientRect();
  if (!rect) return undefined;
  return rasterBudgetForViewport(rect, zoomLevelForViewport(rect.width));
}

/** True once the effect that started this boot has been cleaned up (component unmounted). */
type IsCancelled = () => boolean;

/**
 * Awaits the session's index/graph, then builds the initial runtime at a seeded spawn node.
 * Returns `null` without touching `runtimeRef` when `isCancelled` reports true after the wait —
 * the boot effect's cleanup runs synchronously and unconditionally disposes `session` before any
 * later `await` in this function can resume, so a cancelled caller never needs to dispose again.
 */
async function bootSession(
  session: WorldSession,
  zoneKey: ZoneKey,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  runtimeRef: RefObject<Runtime | null>,
  reducedMotionRef: RefObject<boolean>,
  settingsRef: RefObject<ArenaSettings>,
  isCancelled: IsCancelled,
): Promise<{ index: MapIndex; spawn: Point } | null> {
  const { index } = await session.ready();
  if (isCancelled()) return null;
  const zone = findZoneByKey(index, zoneKey) ?? index.zones.at(0) ?? null;
  const width =
    canvasRef.current?.getBoundingClientRect().width ??
    DEFAULT_VIEWPORT_WIDTH_PX;
  const runtime = createRuntime(
    session,
    index,
    zone,
    width,
    reducedMotionRef.current,
    settingsRef.current.sound,
    undefined,
    {
      enabled: settingsRef.current.radio,
      stationId: settingsRef.current.radioStation,
    },
  );
  runtime.hapticsEnabled = settingsRef.current.vibrate;
  runtime.sound.setAmbienceEnabled(settingsRef.current.ambience);
  runtime.quality = settingsRef.current.quality;
  runtime.dynamicCamera = settingsRef.current.dynamicCamera;
  runtime.camera3d = settingsRef.current.camera3d;
  runtimeRef.current = runtime;
  return {
    index,
    spawn: [myPlayer(runtime).x, myPlayer(runtime).y],
  };
}

/** Options for {@link useArenaBoot}. */
type ArenaBootOptions = {
  zoneKey: ZoneKey;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  runtimeRef: RefObject<Runtime | null>;
  reducedMotionRef: RefObject<boolean>;
  settingsRef: RefObject<ArenaSettings>;
};

/**
 * Result of {@link useArenaBoot}; `setProgress` and `setFailed` let the frame loop push
 * tile-sync updates after boot has handed the runtime over.
 */
type ArenaBootResult = {
  phase: ArenaPhase;
  /** Counts finished boots; a new runtime (another zone) bumps it. */
  epoch: number;
  progress: LoadProgress;
  failed: boolean;
  zones: MapZone[];
  setProgress: (progress: LoadProgress) => void;
  setFailed: (failed: boolean) => void;
};

/** State setters {@link finishBoot} updates as the initial load completes. */
type BootSetters = {
  setZones: (zones: MapZone[]) => void;
  setProgress: (progress: LoadProgress) => void;
  setFailed: (failed: boolean) => void;
  setPhase: (phase: ArenaPhase) => void;
  /** Called once the booted runtime is playing. */
  onBooted: () => void;
};

/**
 * Finishes booting after {@link bootSession} resolves: seeds the zone list, streams the initial
 * tiles (reporting progress as each one settles so the loading screen moves), derives the
 * failed-tiles flag from the loader's own bookkeeping, then flips the phase to "playing". No-ops
 * once `isCancelled` reports true.
 */
async function finishBoot(
  session: WorldSession,
  booted: { index: MapIndex; spawn: Point } | null,
  isCancelled: IsCancelled,
  setters: BootSetters,
): Promise<void> {
  if (!booted || isCancelled()) return;
  setters.setZones(booted.index.zones);
  const tileProgress = await session.update(booted.spawn, (progress) => {
    if (!isCancelled()) setters.setProgress(progress);
  });
  if (isCancelled()) return;
  setters.setProgress(tileProgress);
  setters.setFailed(session.hasFailures());
  setters.setPhase("playing");
  setters.onBooted();
}

/** Boots the world session for `zoneKey`: loads the map, spawns the player, disposes on unmount. */
function useArenaBoot(options: ArenaBootOptions): ArenaBootResult {
  const { zoneKey, canvasRef, runtimeRef, reducedMotionRef, settingsRef } =
    options;
  const [phase, setPhase] = useState<ArenaPhase>("loading");
  const [progress, setProgress] = useState<LoadProgress>(NO_PROGRESS);
  const [failed, setFailed] = useState(false);
  const [zones, setZones] = useState<MapZone[]>([]);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const isCancelled: IsCancelled = () => cancelled;
    const session = createArenaSession(
      () => setFailed(true),
      rasterBudgetForCanvas(canvasRef),
    );
    bootSession(
      session,
      zoneKey,
      canvasRef,
      runtimeRef,
      reducedMotionRef,
      settingsRef,
      isCancelled,
    )
      .then((booted) =>
        finishBoot(session, booted, isCancelled, {
          setZones,
          setProgress,
          setFailed,
          setPhase,
          onBooted: () => setEpoch((count) => count + 1),
        }),
      )
      .catch((error: unknown) => {
        reportArenaError(error, "boot");
        if (!cancelled) setPhase("error");
      });
    return () => {
      cancelled = true;
      if (runtimeRef.current) {
        runtimeRef.current.disposed = true;
        runtimeRef.current.sound.dispose();
      }
      session.dispose();
      runtimeRef.current = null;
    };
    // reducedMotionRef is listed for exhaustive-deps only: ref identity never changes across
    // renders, so a media-query-driven reducedMotion change never re-runs this effect.
  }, [canvasRef, runtimeRef, zoneKey, reducedMotionRef, settingsRef]);

  return { phase, epoch, progress, failed, zones, setProgress, setFailed };
}

/** Binds the keyboard and the wheel, with the menu able to take the keyboard away. */
function useKeyboardBindings(
  inputRef: RefObject<InputState>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  runtimeRef: RefObject<Runtime | null>,
  keys: ArenaKeyOptions | undefined,
  onRadio: () => void,
  onToggleCamera: () => void,
): void {
  const suspended = keys?.suspended ?? false;
  const onScoreboard = keys?.onScoreboard;
  const suspendedRef = useRef(suspended);
  useEffect(() => {
    suspendedRef.current = suspended;
    // A key held as the menu opened must not stay held behind it.
    if (suspended) inputRef.current.clearKeyboard();
  }, [suspended, inputRef]);
  useEffect(
    () =>
      attachKeyboard(
        window,
        inputRef.current,
        () => runtimeRef.current?.sound.unlock(),
        {
          onScoreboard,
          onWeaponSlot: (slot) =>
            runtimeRef.current?.weapons.request(SLOT_WEAPONS[slot]),
          onRadio,
          onToggleCamera,
          isSuspended: () => suspendedRef.current,
        },
      ),
    [inputRef, runtimeRef, onScoreboard, onRadio, onToggleCamera],
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    return attachWheel(canvas, () => runtimeRef.current?.weapons.cycle());
  }, [canvasRef, runtimeRef]);
}

/**
 * Binds mouse aim and the left button on the canvas. In 3D the click that takes the pointer lock
 * belongs to mouse-look (`MouseLook.claimsClick`), so it aims but does not shoot.
 */
function usePointerAim(
  inputRef: RefObject<InputState>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  pointerRef: RefObject<PointerAim | null>,
  runtimeRef: RefObject<Runtime | null>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const aim = attachPointerAim(
      canvas,
      inputRef.current,
      () => runtimeRef.current?.sound.unlock(),
      () => runtimeRef.current?.look?.claimsClick() ?? false,
    );
    pointerRef.current = aim;
    return () => {
      aim.detach();
      pointerRef.current = null;
    };
  }, [canvasRef, inputRef, pointerRef, runtimeRef]);
}

/** What {@link useArenaView3d} needs from the game hook. */
type ArenaView3dOptions = {
  /** Playing on a screen of its own: split screen and the TV stay 2D. */
  live: boolean;
  epoch: number;
  settings: ArenaSettings;
  updateSettings: (patch: Partial<ArenaSettings>) => void;
  runtimeRef: RefObject<Runtime | null>;
  /** Where the right mouse button's sights go (aim spec §5). */
  inputRef: RefObject<InputState>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onPause?: () => void;
  /** The V key's action, bound once by the keyboard. */
  toggleCameraRef: RefObject<() => void>;
};

/**
 * The game's 3D view (spec §6): runs while playing in 3D on an unshared screen, falls back to 2D
 * when it fails, pauses into the menu when the pointer lock is let go, and makes V flip the 3D
 * camera — a no-op in 2D, where there is no third/first person to switch between (spec §6.3).
 */
function useArenaView3d(options: ArenaView3dOptions): View3dControls {
  const { settings, updateSettings, toggleCameraRef, onPause } = options;
  const fallbackTo2d = useCallback(
    () => updateSettings({ view: "2d" }),
    [updateSettings],
  );
  useEffect(() => {
    toggleCameraRef.current = () => {
      if (settings.view !== "3d") return;
      const camera3d = settings.camera3d === "third" ? "first" : "third";
      updateSettings({ camera3d });
    };
  }, [settings, toggleCameraRef, updateSettings]);
  return useView3d({
    active: options.live && settings.view === "3d",
    epoch: options.epoch,
    mode: settings.camera3d,
    runtimeRef: options.runtimeRef,
    inputRef: options.inputRef,
    hudCanvasRef: options.canvasRef,
    onFallback: fallbackTo2d,
    onPause: () => onPause?.(),
  });
}

/** Attaches keyboard and mouse aim on mount; returns the setters the touch controls drive. */
function useArenaInput(
  inputRef: RefObject<InputState>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  pointerRef: RefObject<PointerAim | null>,
  runtimeRef: RefObject<Runtime | null>,
  keys: ArenaKeyOptions | undefined,
  onRadio: () => void,
  onToggleCamera: () => void,
): {
  setInputVector(vector: [number, number] | null): void;
  setAimVector(vector: [number, number] | null): void;
  setButton(name: ButtonName, pressed: boolean): void;
} {
  useKeyboardBindings(
    inputRef,
    canvasRef,
    runtimeRef,
    keys,
    onRadio,
    onToggleCamera,
  );
  usePointerAim(inputRef, canvasRef, pointerRef, runtimeRef);
  const setInputVector = useCallback(
    (vector: [number, number] | null) => {
      if (vector) runtimeRef.current?.sound.unlock();
      inputRef.current.setStick(vector);
    },
    [inputRef, runtimeRef],
  );
  const setAimVector = useCallback(
    (vector: [number, number] | null) => {
      if (vector) runtimeRef.current?.sound.unlock();
      const angle = aimFromVector(vector);
      inputRef.current.setStickAim(angle);
      inputRef.current.setButton("buttons", "fire", angle !== null);
    },
    [inputRef, runtimeRef],
  );
  const setButton = useCallback(
    (name: ButtonName, pressed: boolean) => {
      if (pressed) runtimeRef.current?.sound.unlock();
      inputRef.current.setButton("buttons", name, pressed);
    },
    [inputRef, runtimeRef],
  );
  return { setInputVector, setAimVector, setButton };
}

/** Drives the fixed-step simulation and render loop via requestAnimationFrame while "playing". */
function useFrameLoop(phase: ArenaPhase, options: FrameLoopOptions): void {
  const {
    canvasRef,
    runtimeRef,
    inputRef,
    pointerRef,
    metricsRef,
    debug,
    setProgress,
    setFailed,
    setHud,
    setRadar,
    setDeath,
    setDebugSnapshot,
  } = options;
  useEffect(() => {
    if (phase !== "playing") return undefined;
    return startFrameLoop({
      canvasRef,
      runtimeRef,
      inputRef,
      pointerRef,
      metricsRef,
      debug,
      setProgress,
      setFailed,
      setHud,
      setRadar,
      setDeath,
      setDebugSnapshot,
    });
  }, [
    phase,
    canvasRef,
    runtimeRef,
    inputRef,
    pointerRef,
    metricsRef,
    debug,
    setProgress,
    setFailed,
    setHud,
    setRadar,
    setDeath,
    setDebugSnapshot,
  ]);
}

/** Builds the `window.__arena` seam over the runtime ref. */
function createTestHooks(
  runtimeRef: RefObject<Runtime | null>,
  metricsRef: RefObject<FrameMetrics>,
): ArenaTestHooks {
  return {
    getState: () => runtimeRef.current?.state ?? null,
    getMetrics: () => metricsRef.current.snapshot(),
    dispatch(input, ticks = 1) {
      const runtime = runtimeRef.current;
      if (runtime)
        runtime.injected = { input: createInput(input), ticksLeft: ticks };
    },
    damage(amount) {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const player = damagePlayer(
        myPlayer(runtime),
        amount,
        runtime.state.tick,
      );
      runtime.state = replacePlayer(runtime.state, player);
    },
    setZoneEnforced(enabled) {
      const runtime = runtimeRef.current;
      if (runtime)
        runtime.state = {
          ...runtime.state,
          zoneEnforced: enabled,
          enforcedZoneKey: enabled ? runtime.state.activeZoneKey : null,
        };
    },
    addHeat(amount) {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const player = addHeat(myPlayer(runtime), amount, runtime.state.tick);
      runtime.state = replacePlayer(runtime.state, player);
    },
    getViolations: () => runtimeRef.current?.violations ?? 0,
    audio: {
      levels: () => runtimeRef.current?.sound.debug().world.ambience ?? null,
      voices: () => runtimeRef.current?.sound.debug() ?? null,
    },
  };
}

/** Installs `window.__arena` while `debug` is on. */
function useArenaTestHooks(
  debug: boolean,
  runtimeRef: RefObject<Runtime | null>,
  metricsRef: RefObject<FrameMetrics>,
): void {
  useEffect(() => {
    if (!debug) return undefined;
    return installArenaHooks(window, createTestHooks(runtimeRef, metricsRef));
  }, [debug, metricsRef, runtimeRef]);
}

/** Keeps the reduced-motion preference on the boot ref and on the live runtime. */
function useReducedMotionSync(
  reducedMotion: boolean,
  reducedMotionRef: RefObject<boolean>,
  runtimeRef: RefObject<Runtime | null>,
): void {
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
    if (runtimeRef.current) runtimeRef.current.reducedMotion = reducedMotion;
  }, [reducedMotion, reducedMotionRef, runtimeRef]);
}

/** The zone-picker teleport: moves the player and refreshes the HUD at once. */
function useTeleport(
  runtimeRef: RefObject<Runtime | null>,
  setHud: (hud: ArenaHud) => void,
): (key: ZoneKey) => void {
  return useCallback(
    (key: ZoneKey) => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const zone = findZoneByKey(runtime.session.index(), key);
      if (!zone) return;
      applyTeleport(runtime, zone);
      setHud(
        computeHud(
          runtime.session,
          runtime.state,
          myPlayer(runtime),
          runtime.soundEnabled,
          hudRadioStation(runtime),
        ),
      );
    },
    [runtimeRef, setHud],
  );
}

/** The mutable refs shared across the boot, input and frame-loop hooks. */
type ArenaRuntimeRefs = {
  runtimeRef: RefObject<Runtime | null>;
  inputRef: RefObject<InputState>;
  pointerRef: RefObject<PointerAim | null>;
  metricsRef: RefObject<FrameMetrics>;
  reducedMotionRef: RefObject<boolean>;
};

/** Creates the refs `useArenaGame` threads through its child hooks; split out to keep it short. */
function useArenaRuntimeRefs(reducedMotion: boolean): ArenaRuntimeRefs {
  const runtimeRef = useRef<Runtime | null>(null);
  const inputRef = useRef(createInputState());
  const pointerRef = useRef<PointerAim | null>(null);
  const metricsRef = useRef(createFrameMetrics());
  const reducedMotionRef = useRef(reducedMotion);
  return { runtimeRef, inputRef, pointerRef, metricsRef, reducedMotionRef };
}

/** The hud/death/debug-snapshot state `useArenaGame` renders from; split out to keep it short. */
type ArenaGameState = {
  hud: ArenaHud;
  setHud: (hud: ArenaHud) => void;
  death: DeathInfo | null;
  setDeath: (death: DeathInfo | null) => void;
  debugSnapshot: DebugSnapshot | null;
  setDebugSnapshot: (snapshot: DebugSnapshot | null) => void;
  radar: RadarSnapshot;
  setRadar: Dispatch<SetStateAction<RadarSnapshot>>;
};

/** The three state slices the frame loop writes into and the hook exposes to the overlay. */
function useArenaGameState(soundEnabled: boolean): ArenaGameState {
  const [hud, setHud] = useState<ArenaHud>(() => ({
    ...INITIAL_HUD,
    soundEnabled,
  }));
  const [death, setDeath] = useState<DeathInfo | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(
    null,
  );
  const [radar, setRadar] = useState<RadarSnapshot>(EMPTY_RADAR_SNAPSHOT);
  return {
    hud,
    setHud,
    death,
    setDeath,
    debugSnapshot,
    setDebugSnapshot,
    radar,
    setRadar,
  };
}

/** Pushes the settings that the runtime acts on into it. */
function applySettings(runtime: Runtime | null, settings: ArenaSettings): void {
  if (!runtime) return;
  runtime.soundEnabled = settings.sound;
  runtime.sound.setEnabled(settings.sound);
  if (settings.sound) runtime.sound.unlock();
  runtime.hapticsEnabled = settings.vibrate;
  runtime.quality = settings.quality;
  runtime.dynamicCamera = settings.dynamicCamera;
  runtime.camera3d = settings.camera3d;
  runtime.sound.radio?.setEnabled(settings.radio);
  runtime.sound.radio?.tune(settings.radioStation ?? "");
  runtime.sound.setAmbienceEnabled(settings.ambience);
}

/** Owns the world session, the fixed-step arena loop, the camera, the HUD and the death screen state. */
export function useArenaGame({
  zoneKey,
  canvasRef,
  debug,
  reducedMotion = false,
  netplay,
  keys,
  sharedScreen,
}: UseArenaGameOptions): ArenaGame {
  const [settings, setSettings] = useState<ArenaSettings>(() =>
    loadArenaSettings(),
  );
  const settingsRef = useRef(settings);
  const { runtimeRef, inputRef, pointerRef, metricsRef, reducedMotionRef } =
    useArenaRuntimeRefs(reducedMotion);
  const {
    hud,
    setHud,
    death,
    setDeath,
    debugSnapshot,
    setDebugSnapshot,
    radar,
    setRadar,
  } = useArenaGameState(settings.sound);
  useReducedMotionSync(reducedMotion, reducedMotionRef, runtimeRef);
  const { phase, epoch, progress, failed, zones, setProgress, setFailed } =
    useArenaBoot({
      zoneKey,
      canvasRef,
      runtimeRef,
      reducedMotionRef,
      settingsRef,
    });
  // The R and V keys are bound once; what they do is decided below, once the settings can be
  // updated.
  const nextStationRef = useRef<() => void>(() => undefined);
  const onRadioKey = useCallback(() => nextStationRef.current(), []);
  const toggleCameraRef = useRef<() => void>(() => undefined);
  const onToggleCameraKey = useCallback(() => toggleCameraRef.current(), []);
  const { setInputVector, setAimVector, setButton } = useArenaInput(
    inputRef,
    canvasRef,
    pointerRef,
    runtimeRef,
    keys,
    onRadioKey,
    onToggleCameraKey,
  );
  const selectWeapon = useCallback(
    (slot: WeaponSlot) =>
      runtimeRef.current?.weapons.request(SLOT_WEAPONS[slot]),
    [runtimeRef],
  );
  const cycleWeapon = useCallback(
    () => runtimeRef.current?.weapons.cycle(),
    [runtimeRef],
  );
  useArenaTestHooks(debug, runtimeRef, metricsRef);
  useFrameLoop(phase, {
    canvasRef,
    runtimeRef,
    inputRef,
    pointerRef,
    metricsRef,
    debug,
    setProgress,
    setFailed,
    setHud,
    setRadar,
    setDeath,
    setDebugSnapshot,
  });
  useNetplay(runtimeRef, phase === "playing", netplay);
  useArenaMissionSave(runtimeRef, phase === "playing" && !netplay);
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.sharedScreen = sharedScreen;
    runtime.inputSuspended = keys?.suspended ?? false;
    if (runtime.inputSuspended) inputRef.current.clearAll();
  }, [sharedScreen, keys?.suspended, phase, runtimeRef, inputRef]);
  const seam = useMatchSeam(runtimeRef);
  const navigationMap = useCallback((): NavigationMapData | null => {
    const runtime = runtimeRef.current;
    return runtime
      ? {
          index: runtime.session.index(),
          graph: runtime.session.graph(),
          missions: missionMapMarkers(
            runtime.session.index(),
            runtime.state,
            myPlayer(runtime),
          ),
        }
      : null;
  }, [runtimeRef]);
  const setDestination = useCallback(
    (point: Point | null) => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const player = myPlayer(runtime);
      runtime.navigation.select(
        point,
        [player.x, player.y],
        player.vehicleId !== null,
      );
      const navigation = runtime.navigation.snapshot();
      setRadar((previous) => ({ ...previous, navigation }));
    },
    [runtimeRef, setRadar],
  );
  const teleportToZone = useTeleport(runtimeRef, setHud);
  const updateSettings = useCallback(
    (patch: Partial<ArenaSettings>) => {
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      applySettings(runtimeRef.current, next);
      if (patch.sound !== undefined)
        setHud({ ...hud, soundEnabled: next.sound });
      saveArenaSettings(patch);
    },
    [hud, runtimeRef, setHud],
  );
  const setSound = useCallback(
    (enabled: boolean) => updateSettings({ sound: enabled }),
    [updateSettings],
  );
  const view3d = useArenaView3d({
    live: phase === "playing" && !sharedScreen,
    epoch,
    settings,
    updateSettings,
    runtimeRef,
    inputRef,
    canvasRef,
    onPause: keys?.onPause,
    toggleCameraRef,
  });
  const nextStation = useCallback(() => {
    const station = runtimeRef.current?.sound.radio?.nextStation();
    if (station) updateSettings({ radioStation: station.id });
  }, [runtimeRef, updateSettings]);
  const missionSequence = useRef(0);
  const nextRadioTrack = useCallback(
    () => runtimeRef.current?.sound.radio?.nextTrack(),
    [runtimeRef],
  );
  const missionAction = useCallback(
    (command: Omit<MissionCommand, "sequence">) => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      missionSequence.current =
        Math.max(
          missionSequence.current,
          myPlayer(runtime).mission?.lastCommand ?? 0,
        ) + 1;
      inputRef.current.clearAll();
      inputRef.current.setMissionCommand({
        ...command,
        sequence: missionSequence.current,
      });
    },
    [runtimeRef, inputRef],
  );
  useEffect(() => {
    nextStationRef.current = nextStation;
  }, [nextStation]);

  return {
    ...seam,
    missionAction,
    phase,
    progress,
    failed,
    hud,
    zones,
    death,
    radar,
    setSound,
    settings,
    updateSettings,
    setInputVector,
    setAimVector,
    setButton,
    selectWeapon,
    cycleWeapon,
    nextStation,
    nextRadioTrack,
    teleportToZone,
    navigationMap,
    setDestination,
    debugSnapshot,
    view3d,
  };
}
