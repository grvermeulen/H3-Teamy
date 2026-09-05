"use client";

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
import { attachKeyboard } from "@/lib/cityArena/input/keyboard";
import {
  attachPointerAim,
  type PointerAim,
} from "@/lib/cityArena/input/pointerAim";
import { zoomLevelForViewport } from "@/lib/cityArena/render/camera";
import { createDomCanvasFactory } from "@/lib/cityArena/render/canvasTypes";
import { rasterBudgetForViewport } from "@/lib/cityArena/render/staticRaster";
import { PLAYER_MAX_HEALTH, damagePlayer } from "@/lib/cityArena/sim/damage";
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
import {
  aimAngle,
  applyTeleport,
  computeHud,
  createRuntime,
  nearestLandmarkTo,
  reportArenaError,
  startFrameLoop,
  type ArenaHud,
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
};
/** Hook options. */
export type UseArenaGameOptions = {
  zoneKey: ZoneKey;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  debug: boolean;
  reducedMotion?: boolean;
};
/** Hook result consumed by the overlay. */
export type ArenaGame = {
  phase: ArenaPhase;
  progress: LoadProgress;
  failed: boolean;
  hud: ArenaHud;
  zones: MapZone[];
  death: DeathInfo | null;
  setInputVector(vector: [number, number] | null): void;
  setButton(name: ButtonName, pressed: boolean): void;
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
  return createWorldSession({
    loader,
    canvasFactory: createDomCanvasFactory(),
    rasterBudgetBytes,
  });
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
  );
  runtimeRef.current = runtime;
  return { index, spawn: [runtime.state.player.x, runtime.state.player.y] };
}

/** Options for {@link useArenaBoot}. */
type ArenaBootOptions = {
  zoneKey: ZoneKey;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  runtimeRef: RefObject<Runtime | null>;
  reducedMotionRef: RefObject<boolean>;
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
  const { zoneKey, canvasRef, runtimeRef, reducedMotionRef } = options;
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
      session.dispose();
      runtimeRef.current = null;
    };
    // reducedMotionRef is listed for exhaustive-deps only: ref identity never changes across
    // renders, so a media-query-driven reducedMotion change never re-runs this effect.
  }, [canvasRef, runtimeRef, zoneKey, reducedMotionRef]);

  return { phase, progress, failed, zones, setProgress, setFailed };
}

/** Attaches keyboard and mouse aim on mount; returns the setters the touch controls drive. */
function useArenaInput(
  inputRef: RefObject<InputState>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  pointerRef: RefObject<PointerAim | null>,
): {
  setInputVector(vector: [number, number] | null): void;
  setButton(name: ButtonName, pressed: boolean): void;
} {
  useEffect(() => attachKeyboard(window, inputRef.current), [inputRef]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const aim = attachPointerAim(canvas, inputRef.current);
    pointerRef.current = aim;
    return () => {
      aim.detach();
      pointerRef.current = null;
    };
  }, [canvasRef, inputRef, pointerRef]);
  const setInputVector = useCallback(
    (vector: [number, number] | null) => inputRef.current.setStick(vector),
    [inputRef],
  );
  const setButton = useCallback(
    (name: ButtonName, pressed: boolean) =>
      inputRef.current.setButton("buttons", name, pressed),
    [inputRef],
  );
  return { setInputVector, setButton };
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
        runtime.state.player,
        amount,
        runtime.state.tick,
      );
      runtime.state = { ...runtime.state, player };
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
      setHud(computeHud(runtime.session, runtime.state));
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
};

/** The three state slices the frame loop writes into and the hook exposes to the overlay. */
function useArenaGameState(): ArenaGameState {
  const [hud, setHud] = useState<ArenaHud>(INITIAL_HUD);
  const [death, setDeath] = useState<DeathInfo | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(
    null,
  );
  return { hud, setHud, death, setDeath, debugSnapshot, setDebugSnapshot };
}

/** Owns the world session, the fixed-step arena loop, the camera, the HUD and the death screen state. */
export function useArenaGame({
  zoneKey,
  canvasRef,
  debug,
  reducedMotion = false,
}: UseArenaGameOptions): ArenaGame {
  const { runtimeRef, inputRef, pointerRef, metricsRef, reducedMotionRef } =
    useArenaRuntimeRefs(reducedMotion);
  const { hud, setHud, death, setDeath, debugSnapshot, setDebugSnapshot } =
    useArenaGameState();
  useReducedMotionSync(reducedMotion, reducedMotionRef, runtimeRef);
  const { phase, progress, failed, zones, setProgress, setFailed } =
    useArenaBoot({ zoneKey, canvasRef, runtimeRef, reducedMotionRef });
  const { setInputVector, setButton } = useArenaInput(
    inputRef,
    canvasRef,
    pointerRef,
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
    setDeath,
    setDebugSnapshot,
  });
  const teleportToZone = useTeleport(runtimeRef, setHud);

  return {
    phase,
    progress,
    failed,
    hud,
    zones,
    death,
    setInputVector,
    setButton,
    teleportToZone,
    debugSnapshot,
  };
}
