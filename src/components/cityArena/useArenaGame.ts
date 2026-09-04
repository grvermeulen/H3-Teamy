"use client";

import * as Sentry from "@sentry/nextjs";
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
  type MetricsSnapshot,
} from "@/lib/cityArena/debugMetrics";
import {
  createInputState,
  type InputState,
} from "@/lib/cityArena/input/inputState";
import { attachKeyboard } from "@/lib/cityArena/input/keyboard";
import {
  createCamera,
  updateCamera,
  zoomLevelForViewport,
  type Camera,
} from "@/lib/cityArena/render/camera";
import { createDomCanvasFactory } from "@/lib/cityArena/render/canvasTypes";
import { renderScene } from "@/lib/cityArena/render/renderScene";
import {
  createFreeRoamState,
  stepFreeRoam,
  teleportPlayer,
} from "@/lib/cityArena/sim/freeRoam";
import { SIM_STEP_S } from "@/lib/cityArena/sim/player";
import { createRng, seedFromString } from "@/lib/cityArena/sim/rng";
import type {
  FreeRoamState,
  PlayerState,
  WorldInput,
} from "@/lib/cityArena/sim/types";
import { saveArenaSettings } from "@/lib/cityArena/storage";
import {
  createMapLoader,
  type LoadProgress,
} from "@/lib/cityArena/world/mapLoader";
import type {
  MapIndex,
  MapZone,
  ZoneKey,
} from "@/lib/cityArena/world/mapTypes";
import { nearestRoadName } from "@/lib/cityArena/world/nearestRoad";
import type { Point } from "@/lib/cityArena/world/projection";
import { findPath, pathLength } from "@/lib/cityArena/world/roadGraph";
import {
  createWorldSession,
  type WorldSession,
} from "@/lib/cityArena/world/worldSession";
import { findZone, findZoneByKey, pickSpawn } from "@/lib/cityArena/world/zone";

/** How often (ms) the loader streams new tiles around the player during play. */
const TILE_REFRESH_MS = 500;
/** How often (ms) the HUD's zone/street text is recomputed. */
const HUD_REFRESH_MS = 250;
/** How often (ms) the debug panel snapshot is rebuilt. */
const DEBUG_REFRESH_MS = 500;
/** Largest per-frame delta time accepted, so a stalled tab cannot cause a huge simulation jump. */
const MAX_FRAME_S = 0.1;
/** Hard cap on fixed-step iterations per rendered frame; guards against a runaway loop if `dt` were ever unclamped. */
const MAX_SIM_STEPS_PER_FRAME = 8;
/** Fallback viewport width (CSS px) for the initial zoom, before the canvas has been laid out. */
const DEFAULT_VIEWPORT_WIDTH_PX = 390;
/** Maximum distance (metres) a landmark's centre may sit from the road graph and still snap onto it. */
const LANDMARK_SNAP_DISTANCE_M = 200;
/** Milliseconds per second, for converting between frame timestamps and simulation seconds. */
const MS_PER_SECOND = 1000;

/** Overlay lifecycle phase. */
export type ArenaPhase = "loading" | "playing" | "error";
/** Text shown in the HUD strip. */
export type ArenaHud = { zoneName: string | null; street: string | null };
/** Data for the debug panel. */
export type DebugSnapshot = {
  metrics: MetricsSnapshot;
  chunks: { chunks: number; bytes: number };
  tiles: number;
  camera: Camera;
  player: PlayerState;
  routeMetres: number | null;
};
/** Hook options. */
export type UseArenaGameOptions = {
  zoneKey: ZoneKey;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  debug: boolean;
};
/** Hook result consumed by the overlay. */
export type ArenaGame = {
  phase: ArenaPhase;
  progress: LoadProgress;
  failed: boolean;
  hud: ArenaHud;
  zones: MapZone[];
  setInputVector(vector: [number, number] | null): void;
  teleportToZone(key: ZoneKey): void;
  debugSnapshot: DebugSnapshot | null;
};

/** Mutable per-frame state shared by the boot, input and frame-loop hooks. */
type Runtime = {
  session: WorldSession;
  state: FreeRoamState;
  camera: Camera;
  accumulator: number;
  lastTileSync: number;
  lastHud: number;
  lastDebug: number;
};

/** Reports a failure through Sentry, tagged so arena issues are easy to filter. */
function reportArenaError(error: unknown, kind: string): void {
  Sentry.captureException(error, { tags: { area: "arena", kind } });
}

/** Resizes the canvas to its layout size (device-pixel aware) and paints the current frame. */
function paintCanvas(
  canvas: HTMLCanvasElement,
  runtime: Runtime,
  zone: MapZone | null,
): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.round(rect.width * dpr);
  const targetHeight = Math.round(rect.height * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const { session, state, camera } = runtime;
  renderScene(
    ctx,
    { rect: { x: 0, y: 0, width: rect.width, height: rect.height }, camera },
    {
      world: {
        raster: session.raster,
        tiles: session.tiles(),
        landmarks: session.landmarks(),
        loadedTileRects: session.loadedTileRects(),
      },
      player: state.player,
      zone,
    },
  );
}

/** Walking distance to the nearest landmark along the road graph, or `null` when none is reachable. */
function routeToNearestLandmark(runtime: Runtime): number | null {
  const index = runtime.session.index();
  const graph = runtime.session.graph();
  const from = graph.nearestNode([
    runtime.state.player.x,
    runtime.state.player.y,
  ]);
  if (from === null || index.landmarks.length === 0) return null;
  const nearest = index.landmarks
    .map((landmark) =>
      graph.nearestNode(
        [
          landmark.center[0] / index.unitsPerMetre,
          landmark.center[1] / index.unitsPerMetre,
        ],
        LANDMARK_SNAP_DISTANCE_M,
      ),
    )
    .find((node): node is number => node !== null);
  if (nearest === undefined) return null;
  const path = findPath(graph, from, nearest);
  return path ? pathLength(graph, path) : null;
}

/** Creates the map loader and world session; tile failures are reported and surfaced via `onFailed`. */
function createArenaSession(onFailed: () => void): WorldSession {
  const loader = createMapLoader({
    onError: (error, file) => {
      reportArenaError(error, `tile-load:${file}`);
      onFailed();
    },
  });
  return createWorldSession({
    loader,
    canvasFactory: createDomCanvasFactory(),
  });
}

/** A pseudo-random spawn point inside `zone`, reseeded from the zone key and the clock each call. */
function randomSpawnPoint(zone: MapZone): Point {
  return pickSpawn(
    zone,
    createRng(seedFromString(`${zone.key}:${Date.now()}`)),
  );
}

/** Moves the player to a random spawn point in `zone` and remembers it as the last-visited zone. */
function applyTeleport(runtime: Runtime, zone: MapZone): void {
  const target = randomSpawnPoint(zone);
  runtime.state = teleportPlayer(
    runtime.state,
    target,
    runtime.session.index(),
  );
  runtime.camera = createCamera(target, runtime.camera.zoom);
  runtime.lastTileSync = 0;
  saveArenaSettings({ lastZone: zone.key });
}

/** Fresh runtime for a session at `spawn`: free-roam state, camera and refresh timers all zeroed. */
function createRuntime(
  session: WorldSession,
  spawn: Point,
  index: MapIndex,
  viewportWidthPx: number,
): Runtime {
  return {
    session,
    state: createFreeRoamState(spawn, index),
    camera: createCamera(spawn, zoomLevelForViewport(viewportWidthPx)),
    accumulator: 0,
    lastTileSync: 0,
    lastHud: 0,
    lastDebug: 0,
  };
}

/** Awaits the session's index/graph, then builds the initial runtime at a random spawn point. */
async function bootSession(
  session: WorldSession,
  zoneKey: ZoneKey,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  runtimeRef: RefObject<Runtime | null>,
): Promise<{ index: MapIndex; spawn: Point }> {
  const { index } = await session.ready();
  const zone = findZoneByKey(index, zoneKey) ?? index.zones[0];
  const spawn: Point = zone ? randomSpawnPoint(zone) : [0, 0];
  const width =
    canvasRef.current?.getBoundingClientRect().width ??
    DEFAULT_VIEWPORT_WIDTH_PX;
  runtimeRef.current = createRuntime(session, spawn, index, width);
  return { index, spawn };
}

/** Options for {@link useArenaBoot}. */
type ArenaBootOptions = {
  zoneKey: ZoneKey;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  runtimeRef: RefObject<Runtime | null>;
};

/** Result of {@link useArenaBoot}; `setProgress` lets the frame loop push tile-sync updates. */
type ArenaBootResult = {
  phase: ArenaPhase;
  progress: LoadProgress;
  failed: boolean;
  zones: MapZone[];
  setProgress: (progress: LoadProgress) => void;
};

/** Boots the world session for `zoneKey`: loads the map, spawns the player, disposes on unmount. */
function useArenaBoot(options: ArenaBootOptions): ArenaBootResult {
  const { zoneKey, canvasRef, runtimeRef } = options;
  const [phase, setPhase] = useState<ArenaPhase>("loading");
  const [progress, setProgress] = useState<LoadProgress>({
    loaded: 0,
    total: 0,
  });
  const [failed, setFailed] = useState(false);
  const [zones, setZones] = useState<MapZone[]>([]);

  useEffect(() => {
    let cancelled = false;
    const session = createArenaSession(() => setFailed(true));
    bootSession(session, zoneKey, canvasRef, runtimeRef)
      .then(async ({ index, spawn }) => {
        setZones(index.zones);
        setProgress(await session.update(spawn));
        if (!cancelled) setPhase("playing");
      })
      .catch((error: unknown) => {
        reportArenaError(error, "boot");
        if (!cancelled) setPhase("error");
      });
    return () => {
      cancelled = true;
      session.dispose();
      runtimeRef.current = null;
    };
  }, [canvasRef, runtimeRef, zoneKey]);

  return { phase, progress, failed, zones, setProgress };
}

/** Attaches WASD/arrow-key input on mount; returns the setter the touch stick drives. */
function useArenaInput(inputRef: RefObject<InputState>): {
  setInputVector(vector: [number, number] | null): void;
} {
  useEffect(() => attachKeyboard(window, inputRef.current), [inputRef]);
  const setInputVector = useCallback(
    (vector: [number, number] | null) => inputRef.current.setStick(vector),
    [inputRef],
  );
  return { setInputVector };
}

/** Zone name and nearest named street for the HUD, from the player's current position. */
function computeHud(session: WorldSession, player: PlayerState): ArenaHud {
  const zone = findZone(session.index(), [player.x, player.y]);
  return {
    zoneName: zone?.name ?? null,
    street: nearestRoadName(session.tiles(), [player.x, player.y]),
  };
}

/** Debug-panel snapshot: frame metrics, cache stats, camera/player position and route distance. */
function buildDebugSnapshot(
  runtime: Runtime,
  metrics: MetricsSnapshot,
): DebugSnapshot {
  return {
    metrics,
    chunks: runtime.session.raster.stats(),
    tiles: runtime.session.tiles().length,
    camera: runtime.camera,
    player: runtime.state.player,
    routeMetres: routeToNearestLandmark(runtime),
  };
}

/** Advances the fixed-step simulation to absorb `dt`, then eases the camera toward the player. */
function advanceSimulation(
  runtime: Runtime,
  dt: number,
  input: WorldInput,
): void {
  runtime.accumulator += dt;
  const world = {
    collision: runtime.session.collision,
    index: runtime.session.index(),
  };
  let steps = 0;
  while (runtime.accumulator >= SIM_STEP_S && steps < MAX_SIM_STEPS_PER_FRAME) {
    runtime.state = stepFreeRoam(runtime.state, input, SIM_STEP_S, world);
    runtime.accumulator -= SIM_STEP_S;
    steps += 1;
  }
  const { player } = runtime.state;
  const velocity: Point = [
    Math.cos(player.facing) * player.speed,
    Math.sin(player.facing) * player.speed,
  ];
  runtime.camera = updateCamera(
    runtime.camera,
    [player.x, player.y],
    velocity,
    dt,
  );
}

/** Seconds elapsed since the previous frame, clamped so a stall cannot cause a huge simulation step. */
function computeFrameDt(
  timestamp: number,
  lastTimestamp: number | null,
): number {
  if (lastTimestamp === null) return SIM_STEP_S;
  return Math.min(MAX_FRAME_S, (timestamp - lastTimestamp) / MS_PER_SECOND);
}

/** Options threaded through the frame loop's per-frame and throttled-refresh helpers. */
type FrameLoopOptions = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  runtimeRef: RefObject<Runtime | null>;
  inputRef: RefObject<InputState>;
  metricsRef: RefObject<FrameMetrics>;
  debug: boolean;
  setProgress: (progress: LoadProgress) => void;
  setHud: (hud: ArenaHud) => void;
  setDebugSnapshot: (snapshot: DebugSnapshot | null) => void;
};

/** Tile-sync, HUD and (when enabled) debug-panel refreshes, each on its own throttle interval. */
function refreshThrottled(
  runtime: Runtime,
  timestamp: number,
  options: FrameLoopOptions,
): void {
  const { player } = runtime.state;
  if (timestamp - runtime.lastTileSync >= TILE_REFRESH_MS) {
    runtime.lastTileSync = timestamp;
    runtime.session
      .update([player.x, player.y])
      .then(options.setProgress, (error: unknown) =>
        reportArenaError(error, "tile-sync"),
      );
  }
  if (timestamp - runtime.lastHud >= HUD_REFRESH_MS) {
    runtime.lastHud = timestamp;
    options.setHud(computeHud(runtime.session, player));
  }
  if (options.debug && timestamp - runtime.lastDebug >= DEBUG_REFRESH_MS) {
    runtime.lastDebug = timestamp;
    options.setDebugSnapshot(
      buildDebugSnapshot(runtime, options.metricsRef.current.snapshot()),
    );
  }
}

/** Simulates, paints and records metrics for one frame, then runs the throttled refreshes. */
function runFrame(
  timestamp: number,
  dt: number,
  runtime: Runtime,
  canvas: HTMLCanvasElement,
  options: FrameLoopOptions,
): void {
  const simStart = performance.now();
  advanceSimulation(runtime, dt, options.inputRef.current.snapshot());
  const drawStart = performance.now();
  const zone = runtime.state.zoneKey
    ? findZoneByKey(runtime.session.index(), runtime.state.zoneKey)
    : null;
  paintCanvas(canvas, runtime, zone);
  const drawEnd = performance.now();
  options.metricsRef.current.record({
    frameMs: dt * MS_PER_SECOND,
    drawMs: drawEnd - drawStart,
    simMs: drawStart - simStart,
  });
  refreshThrottled(runtime, timestamp, options);
}

/** Starts the requestAnimationFrame loop for one boot cycle; returns the cleanup that cancels it. */
function startFrameLoop(options: FrameLoopOptions): () => void {
  let handle = 0;
  let lastTimestamp: number | null = null;
  const tick = (timestamp: number): void => {
    const runtime = options.runtimeRef.current;
    const canvas = options.canvasRef.current;
    if (runtime && canvas) {
      const dt = computeFrameDt(timestamp, lastTimestamp);
      lastTimestamp = timestamp;
      runFrame(timestamp, dt, runtime, canvas, options);
    }
    handle = window.requestAnimationFrame(tick);
  };
  handle = window.requestAnimationFrame(tick);
  return () => window.cancelAnimationFrame(handle);
}

/** Drives the fixed-step simulation and render loop via requestAnimationFrame while "playing". */
function useFrameLoop(phase: ArenaPhase, options: FrameLoopOptions): void {
  const {
    canvasRef,
    runtimeRef,
    inputRef,
    metricsRef,
    debug,
    setProgress,
    setHud,
    setDebugSnapshot,
  } = options;
  useEffect(() => {
    if (phase !== "playing") return undefined;
    return startFrameLoop({
      canvasRef,
      runtimeRef,
      inputRef,
      metricsRef,
      debug,
      setProgress,
      setHud,
      setDebugSnapshot,
    });
  }, [
    phase,
    canvasRef,
    runtimeRef,
    inputRef,
    metricsRef,
    debug,
    setProgress,
    setHud,
    setDebugSnapshot,
  ]);
}

/** Owns the world session, the fixed-step loop, the camera and the HUD/debug state. */
export function useArenaGame({
  zoneKey,
  canvasRef,
  debug,
}: UseArenaGameOptions): ArenaGame {
  const runtimeRef = useRef<Runtime | null>(null);
  const inputRef = useRef(createInputState());
  const metricsRef = useRef(createFrameMetrics());
  const [hud, setHud] = useState<ArenaHud>({ zoneName: null, street: null });
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(
    null,
  );

  const boot = useArenaBoot({ zoneKey, canvasRef, runtimeRef });
  const { setInputVector } = useArenaInput(inputRef);
  useFrameLoop(boot.phase, {
    canvasRef,
    runtimeRef,
    inputRef,
    metricsRef,
    debug,
    setProgress: boot.setProgress,
    setHud,
    setDebugSnapshot,
  });

  const teleportToZone = useCallback((key: ZoneKey) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const zone = findZoneByKey(runtime.session.index(), key);
    if (!zone) return;
    applyTeleport(runtime, zone);
    setHud({ zoneName: zone.name, street: null });
  }, []);

  return {
    phase: boot.phase,
    progress: boot.progress,
    failed: boot.failed,
    hud,
    zones: boot.zones,
    setInputVector,
    teleportToZone,
    debugSnapshot,
  };
}
