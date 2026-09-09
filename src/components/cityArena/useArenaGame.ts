"use client";

import { replacePlayer } from "@/lib/cityArena/sim/players";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
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
import { createDomCanvasFactory } from "@/lib/cityArena/render/canvasTypes";
import { createSpriteStore } from "@/lib/cityArena/render/loadSprites";
import { WHOLE_WORLD_RECT } from "@/lib/cityArena/render/staticRaster";
import { rasterBudgetForViewport } from "@/lib/cityArena/render/staticRaster";
import { PLAYER_MAX_HEALTH, damagePlayer } from "@/lib/cityArena/sim/damage";
import { addHeat } from "@/lib/cityArena/sim/wanted";
import { createInput } from "@/lib/cityArena/sim/types";
import { SPAWN_AMMO } from "@/lib/cityArena/sim/weapons";
import {
  installArenaHooks,
  type ArenaTestHooks,
} from "@/lib/cityArena/test/hooks";
import {
  createMapLoader,
  type LoadProgress,
} from "@/lib/cityArena/world/mapLoader";
import type {
  MapIndex,
  MapZone,
  ZoneKey,
} from "@/lib/cityArena/world/mapTypes";
import type { Point } from "@/lib/cityArena/world/projection";
import {
  createWorldSession,
  type WorldSession,
} from "@/lib/cityArena/world/worldSession";
import { findZoneByKey } from "@/lib/cityArena/world/zone";
import type { ArenaSettings } from "@/lib/cityArena/schemas";
import { loadArenaSettings, saveArenaSettings } from "@/lib/cityArena/storage";
import { computeHud, type ArenaHud } from "./arenaHud";
import { useMatchSeam, type MatchPeek, type MatchSeam } from "./matchSeam";
import { useNetplay, type ArenaNetplayOptions } from "./useNetplay";
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
};

/** The overlay's side of the keyboard (spec §7). */
export type ArenaKeyOptions = {
  /** Tab held shows the scorebord. */
  onScoreboard?: (held: boolean) => void;
  /** True while the menu is open: game keys are ignored and anything held is released. */
  suspended?: boolean;
};
/** Hook result consumed by the overlay. */
export type ArenaGame = MatchSeam & {
  phase: ArenaPhase;
  progress: LoadProgress;
  failed: boolean;
  hud: ArenaHud;
  zones: MapZone[];
  death: DeathInfo | null;
  radar: RadarSnapshot;
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
  teleportToZone(key: ZoneKey): void;
  debugSnapshot: DebugSnapshot | null;
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
  const loader = createMapLoader({ onError: onFailed });
  const canvasFactory = createDomCanvasFactory();
  const sprites = createSpriteStore({ canvasFactory });
  const session = createWorldSession({
    loader,
    canvasFactory,
    rasterBudgetBytes,
    readSprites: () => sprites.current(),
  });
  // Chunks rasterised before the art arrives hold flat fills, so drop them once it has: the
  // frame loop re-rasterises them one per frame, the same way it streams them in the first time.
  void sprites.load().then((loaded) => {
    if (loaded) session.raster.invalidateRect(WHOLE_WORLD_RECT);
  });
  return session;
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
}

/** Boots the world session for `zoneKey`: loads the map, spawns the player, disposes on unmount. */
function useArenaBoot(options: ArenaBootOptions): ArenaBootResult {
  const { zoneKey, canvasRef, runtimeRef, reducedMotionRef, settingsRef } =
    options;
  const [phase, setPhase] = useState<ArenaPhase>("loading");
  const [progress, setProgress] = useState<LoadProgress>({
    loaded: 0,
    total: 0,
  });
  const [failed, setFailed] = useState(false);
  const [zones, setZones] = useState<MapZone[]>([]);

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

  return { phase, progress, failed, zones, setProgress, setFailed };
}

/** Binds the keyboard and the wheel, with the menu able to take the keyboard away. */
function useKeyboardBindings(
  inputRef: RefObject<InputState>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  runtimeRef: RefObject<Runtime | null>,
  keys: ArenaKeyOptions | undefined,
  onRadio: () => void,
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
          isSuspended: () => suspendedRef.current,
        },
      ),
    [inputRef, runtimeRef, onScoreboard, onRadio],
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    return attachWheel(canvas, () => runtimeRef.current?.weapons.cycle());
  }, [canvasRef, runtimeRef]);
}

/** Attaches keyboard and mouse aim on mount; returns the setters the touch controls drive. */
function useArenaInput(
  inputRef: RefObject<InputState>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  pointerRef: RefObject<PointerAim | null>,
  runtimeRef: RefObject<Runtime | null>,
  keys: ArenaKeyOptions | undefined,
  onRadio: () => void,
): {
  setInputVector(vector: [number, number] | null): void;
  setAimVector(vector: [number, number] | null): void;
  setButton(name: ButtonName, pressed: boolean): void;
} {
  useKeyboardBindings(inputRef, canvasRef, runtimeRef, keys, onRadio);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const aim = attachPointerAim(canvas, inputRef.current, () =>
      runtimeRef.current?.sound.unlock(),
    );
    pointerRef.current = aim;
    return () => {
      aim.detach();
      pointerRef.current = null;
    };
  }, [canvasRef, inputRef, pointerRef, runtimeRef]);
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
): ArenaTestHooks {
  return {
    getState: () => runtimeRef.current?.state ?? null,
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
  };
}

/** Installs `window.__arena` while `debug` is on. */
function useArenaTestHooks(
  debug: boolean,
  runtimeRef: RefObject<Runtime | null>,
): void {
  useEffect(() => {
    if (!debug) return undefined;
    return installArenaHooks(window, createTestHooks(runtimeRef));
  }, [debug, runtimeRef]);
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
  setRadar: (radar: RadarSnapshot) => void;
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
  runtime.sound.radio?.setEnabled(settings.radio);
  runtime.sound.radio?.tune(settings.radioStation ?? "");
}

/** Owns the world session, the fixed-step arena loop, the camera, the HUD and the death screen state. */
export function useArenaGame({
  zoneKey,
  canvasRef,
  debug,
  reducedMotion = false,
  netplay,
  keys,
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
  const { phase, progress, failed, zones, setProgress, setFailed } =
    useArenaBoot({
      zoneKey,
      canvasRef,
      runtimeRef,
      reducedMotionRef,
      settingsRef,
    });
  // The R key is bound once; what it does is decided below, once the settings can be updated.
  const nextStationRef = useRef<() => void>(() => undefined);
  const onRadioKey = useCallback(() => nextStationRef.current(), []);
  const { setInputVector, setAimVector, setButton } = useArenaInput(
    inputRef,
    canvasRef,
    pointerRef,
    runtimeRef,
    keys,
    onRadioKey,
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
  useArenaTestHooks(debug, runtimeRef);
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
  const seam = useMatchSeam(runtimeRef);
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
  const nextStation = useCallback(() => {
    const station = runtimeRef.current?.sound.radio?.nextStation();
    if (station) updateSettings({ radioStation: station.id });
  }, [runtimeRef, updateSettings]);
  useEffect(() => {
    nextStationRef.current = nextStation;
  }, [nextStation]);

  return {
    ...seam,
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
    teleportToZone,
    debugSnapshot,
  };
}
