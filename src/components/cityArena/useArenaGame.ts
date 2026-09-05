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
  type ButtonName,
  type InputState,
} from "@/lib/cityArena/input/inputState";
import { attachKeyboard } from "@/lib/cityArena/input/keyboard";
import {
  attachPointerAim,
  type PointerAim,
} from "@/lib/cityArena/input/pointerAim";
import {
  DRIVING_LOOK_AHEAD_MAX_M,
  LOOK_AHEAD_MAX_M,
  createCamera,
  screenToWorld,
  updateCamera,
  zoomLevelForViewport,
  type Camera,
  type Viewport,
} from "@/lib/cityArena/render/camera";
import { createDomCanvasFactory } from "@/lib/cityArena/render/canvasTypes";
import {
  deathScreenPhase,
  type DeathScreenPhase,
} from "@/lib/cityArena/render/deathScreen";
import { renderScene, type Scene } from "@/lib/cityArena/render/renderScene";
import { rasterBudgetForViewport } from "@/lib/cityArena/render/staticRaster";
import {
  createArenaState,
  occupiedVehicle,
  stepArena,
  teleportArenaPlayer,
  type ArenaWorld,
} from "@/lib/cityArena/sim/arena";
import { PLAYER_MAX_HEALTH, damagePlayer } from "@/lib/cityArena/sim/damage";
import { checkInvariants } from "@/lib/cityArena/sim/invariants";
import { SIM_STEP_S } from "@/lib/cityArena/sim/player";
import { createRng, seedFromString } from "@/lib/cityArena/sim/rng";
import {
  createInput,
  type AmmoState,
  type ArenaPlayerState,
  type ArenaState,
  type WeaponKind,
  type WorldInput,
} from "@/lib/cityArena/sim/types";
import { forwardSpeed } from "@/lib/cityArena/sim/vehicle";
import { SPAWN_AMMO } from "@/lib/cityArena/sim/weapons";
import { saveArenaSettings } from "@/lib/cityArena/storage";
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
  MapLandmark,
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
import {
  findZone,
  findZoneByKey,
  landmarkCentreMetres,
  pickSpawn,
} from "@/lib/cityArena/world/zone";
import type { EntityCounts } from "./ArenaDebugOverlay";

/** How often (ms) the loader streams new tiles around the player during play. */
const TILE_REFRESH_MS = 500;
/** How often (ms) the HUD is recomputed (spec §8: 10 Hz). */
const HUD_REFRESH_MS = 100;
/** Prefix of the per-session RNG seed string. */
const SESSION_SEED_PREFIX = "gta-h3";
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
/** Zone, street and vitals shown in the HUD strip. */
export type ArenaHud = {
  zoneName: string | null;
  zoneKey: ZoneKey | null;
  street: string | null;
  health: number;
  weapon: WeaponKind;
  ammo: AmmoState;
  speedMps: number | null;
  inVehicle: boolean;
};
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
/** Data for the debug panel. */
export type DebugSnapshot = {
  metrics: MetricsSnapshot;
  chunks: { chunks: number; bytes: number };
  tiles: number;
  camera: Camera;
  player: ArenaPlayerState;
  routeMetres: number | null;
  entities: EntityCounts;
};
/** The local player's death, stamped with the frame clock, while the death screen is up. */
export type DeathInfo = { diedAtMs: number };
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

/** A debug input that replaces the live one for a number of steps. */
type InjectedInput = { input: WorldInput; ticksLeft: number };

/** Mutable per-frame state shared by the boot, input and frame-loop hooks. */
type Runtime = {
  session: WorldSession;
  state: ArenaState;
  camera: Camera;
  random: () => number;
  accumulator: number;
  lastTileSync: number;
  /** True while a `session.update` tile sync is awaiting the network. */
  tileSyncPending: boolean;
  /** True when the timer or a teleport asked for a sync while one was already in flight. */
  tileSyncRequested: boolean;
  lastHud: number;
  lastDebug: number;
  diedAtMs: number | null;
  injected: InjectedInput | null;
  violations: number;
  reportedViolations: Set<string>;
  reducedMotion: boolean;
};

/** Reports a failure through Sentry, tagged so arena issues are easy to filter. */
function reportArenaError(error: unknown, kind: string): void {
  Sentry.captureException(error, { tags: { area: "arena", kind } });
}

/** The death-screen phase for this frame, or `null` while alive. */
function deathPhase(runtime: Runtime, nowMs: number): DeathScreenPhase | null {
  if (runtime.diedAtMs === null) return null;
  return deathScreenPhase(
    (nowMs - runtime.diedAtMs) / MS_PER_SECOND,
    runtime.reducedMotion,
  );
}

/** Everything the renderer draws this frame. */
function buildScene(
  runtime: Runtime,
  zone: MapZone | null,
  aimScreen: [number, number] | null,
  nowMs: number,
): Scene {
  const { session, state } = runtime;
  return {
    world: {
      raster: session.raster,
      tiles: session.tiles(),
      landmarks: session.landmarks(),
      loadedTileRects: session.loadedTileRects(),
    },
    zone,
    player: state.player,
    vehicles: state.vehicles,
    bullets: state.bullets,
    effects: state.effects,
    tick: state.tick,
    aimScreen,
    pushIn: deathPhase(runtime, nowMs)?.pushIn ?? 1,
  };
}

/** Resizes the canvas to its layout box (device-pixel aware) and paints the scene. */
function paintCanvas(
  canvas: HTMLCanvasElement,
  rect: DOMRect,
  camera: Camera,
  scene: Scene,
): void {
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
  renderScene(
    ctx,
    { rect: { x: 0, y: 0, width: rect.width, height: rect.height }, camera },
    scene,
  );
}

/** Straight-line distance in metres between two points. */
function distanceBetween(first: Point, second: Point): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

/** The landmark whose centre sits closest, straight-line, to `point`. Precondition: `landmarks` is non-empty. */
export function nearestLandmarkTo(
  landmarks: MapLandmark[],
  point: Point,
): MapLandmark {
  return landmarks.reduce((closest, candidate) =>
    distanceBetween(landmarkCentreMetres(candidate), point) <
    distanceBetween(landmarkCentreMetres(closest), point)
      ? candidate
      : closest,
  );
}

/** Walking distance to the nearest landmark along the road graph, or `null` when none is reachable. */
function routeToNearestLandmark(runtime: Runtime): number | null {
  const index = runtime.session.index();
  const graph = runtime.session.graph();
  const playerPoint: Point = [runtime.state.player.x, runtime.state.player.y];
  const from = graph.nearestNode(playerPoint);
  if (from === null || index.landmarks.length === 0) return null;
  const nearestLandmark = nearestLandmarkTo(index.landmarks, playerPoint);
  const to = graph.nearestNode(
    landmarkCentreMetres(nearestLandmark),
    LANDMARK_SNAP_DISTANCE_M,
  );
  if (to === null) return null;
  const path = findPath(graph, from, to);
  return path ? pathLength(graph, path) : null;
}

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

/** Moves the player to a seeded spawn node of `zone` and remembers it as the last-visited zone. */
function applyTeleport(runtime: Runtime, zone: MapZone): void {
  const target = pickSpawn(zone, runtime.random);
  runtime.state = teleportArenaPlayer(
    runtime.state,
    target,
    runtime.session.index(),
  );
  runtime.camera = createCamera(target, runtime.camera.zoom);
  runtime.lastTileSync = 0;
  saveArenaSettings({ lastZone: zone.key });
}

/** Fresh runtime: an arena state seeded from the zone and the clock, the camera at the spawn, timers zeroed. */
function createRuntime(
  session: WorldSession,
  index: MapIndex,
  zone: MapZone | null,
  viewportWidthPx: number,
  reducedMotion: boolean,
): Runtime {
  const seed = seedFromString(
    `${SESSION_SEED_PREFIX}:${zone?.key ?? "none"}:${Date.now()}`,
  );
  const random = createRng(seed);
  const state = createArenaState(
    { index, graph: session.graph(), seed, zone },
    random,
  );
  return {
    session,
    state,
    camera: createCamera(
      [state.player.x, state.player.y],
      zoomLevelForViewport(viewportWidthPx),
    ),
    random,
    accumulator: 0,
    lastTileSync: 0,
    tileSyncPending: false,
    tileSyncRequested: false,
    lastHud: 0,
    lastDebug: 0,
    diedAtMs: null,
    injected: null,
    violations: 0,
    reportedViolations: new Set<string>(),
    reducedMotion,
  };
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

/** World angle from the player to the mouse on the canvas, or `null` without a mouse position. */
export function aimAngle(
  camera: Camera,
  viewport: Viewport,
  player: Point,
  pointer: [number, number] | null,
): number | null {
  if (!pointer) return null;
  const target = screenToWorld(camera, viewport, pointer);
  return Math.atan2(target[1] - player[1], target[0] - player[0]);
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
      inputRef.current.setButton("pointer", name, pressed),
    [inputRef],
  );
  return { setInputVector, setButton };
}

/** Zone, street and vitals for the HUD from the current state. */
export function computeHud(
  session: Pick<WorldSession, "index" | "tiles">,
  state: ArenaState,
): ArenaHud {
  const { player } = state;
  const zone = findZone(session.index(), [player.x, player.y]);
  const car = occupiedVehicle(state);
  return {
    zoneName: zone?.name ?? null,
    zoneKey: zone?.key ?? null,
    street: nearestRoadName(session.tiles(), [player.x, player.y]),
    health: player.health,
    weapon: player.weapon,
    ammo: player.ammo,
    speedMps: car ? Math.abs(forwardSpeed(car)) : null,
    inVehicle: car !== null,
  };
}

/** Debug-panel snapshot: frame metrics, cache stats, camera/player, route distance and entity counts. */
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
    entities: {
      vehicles: runtime.state.vehicles.length,
      bullets: runtime.state.bullets.length,
      effects: runtime.state.effects.length,
      violations: runtime.violations,
    },
  };
}

/** The input for the next step: an injected debug input while its ticks last, else the live one. */
function nextInput(runtime: Runtime, live: WorldInput): WorldInput {
  const injected = runtime.injected;
  if (!injected || injected.ticksLeft <= 0) {
    runtime.injected = null;
    return live;
  }
  runtime.injected = { ...injected, ticksLeft: injected.ticksLeft - 1 };
  return injected.input;
}

/** Runs the invariant checker (debug mode); each distinct message goes to Sentry once per session. */
function recordViolations(runtime: Runtime): void {
  const violations = checkInvariants(runtime.state);
  runtime.violations += violations.length;
  for (const message of violations) {
    if (runtime.reportedViolations.has(message)) continue;
    runtime.reportedViolations.add(message);
    Sentry.captureMessage(`Arena invariant: ${message}`, {
      level: "warning",
      tags: { area: "arena", kind: "invariant" },
    });
  }
}

/** Stamps a death with the frame clock and clears it on respawn; true when it changed. */
function trackDeath(runtime: Runtime, nowMs: number): boolean {
  const dead = runtime.state.player.diedAtTick !== null;
  if (dead === (runtime.diedAtMs !== null)) return false;
  runtime.diedAtMs = dead ? nowMs : null;
  return true;
}

/** Eases the camera after the player or their car, with the driving or walking look-ahead cap. */
function followPlayer(runtime: Runtime, dt: number): void {
  const { player } = runtime.state;
  const car = occupiedVehicle(runtime.state);
  const velocity: Point = car
    ? [car.velocityX, car.velocityY]
    : [
        Math.cos(player.facing) * player.speed,
        Math.sin(player.facing) * player.speed,
      ];
  runtime.camera = updateCamera(
    runtime.camera,
    [player.x, player.y],
    velocity,
    dt,
    car ? DRIVING_LOOK_AHEAD_MAX_M : LOOK_AHEAD_MAX_M,
  );
}

/** Absorbs `dt` (slowed by the death screen's time scale) in fixed steps, then follows the player. */
function advanceSimulation(
  runtime: Runtime,
  dt: number,
  input: WorldInput,
  nowMs: number,
  debug: boolean,
): void {
  runtime.accumulator += dt * (deathPhase(runtime, nowMs)?.timeScale ?? 1);
  const world: ArenaWorld = {
    collision: runtime.session.collision,
    index: runtime.session.index(),
  };
  let steps = 0;
  while (runtime.accumulator >= SIM_STEP_S && steps < MAX_SIM_STEPS_PER_FRAME) {
    const stepInput = nextInput(runtime, input);
    runtime.state = stepArena(
      runtime.state,
      stepInput,
      SIM_STEP_S,
      world,
      runtime.random,
    );
    runtime.accumulator -= SIM_STEP_S;
    steps += 1;
    if (debug) recordViolations(runtime);
  }
  followPlayer(runtime, dt);
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
  pointerRef: RefObject<PointerAim | null>;
  metricsRef: RefObject<FrameMetrics>;
  debug: boolean;
  setProgress: (progress: LoadProgress) => void;
  setFailed: (failed: boolean) => void;
  setHud: (hud: ArenaHud) => void;
  setDeath: (death: DeathInfo | null) => void;
  setDebugSnapshot: (snapshot: DebugSnapshot | null) => void;
};

/**
 * Starts a tile sync at the player's current position. Never runs concurrently with itself:
 * while the request is in flight, {@link refreshThrottled} only flags `tileSyncRequested`
 * instead of starting another one; once this call settles, it starts exactly one follow-up sync
 * (at whatever position the player has reached by then) if that flag was set.
 */
function startTileSync(runtime: Runtime, options: FrameLoopOptions): void {
  runtime.tileSyncPending = true;
  const { player } = runtime.state;
  runtime.session
    .update([player.x, player.y])
    .then(
      (progress) => {
        options.setProgress(progress);
        options.setFailed(runtime.session.hasFailures());
      },
      (error: unknown) => reportArenaError(error, "tile-sync"),
    )
    .finally(() => {
      runtime.tileSyncPending = false;
      if (runtime.tileSyncRequested) {
        runtime.tileSyncRequested = false;
        startTileSync(runtime, options);
      }
    });
}

/** Tile-sync, HUD and (when enabled) debug-panel refreshes, each on its own throttle interval. */
function refreshThrottled(
  runtime: Runtime,
  timestamp: number,
  options: FrameLoopOptions,
): void {
  if (timestamp - runtime.lastTileSync >= TILE_REFRESH_MS) {
    runtime.lastTileSync = timestamp;
    if (runtime.tileSyncPending) runtime.tileSyncRequested = true;
    else startTileSync(runtime, options);
  }
  if (timestamp - runtime.lastHud >= HUD_REFRESH_MS) {
    runtime.lastHud = timestamp;
    options.setHud(computeHud(runtime.session, runtime.state));
  }
  if (options.debug && timestamp - runtime.lastDebug >= DEBUG_REFRESH_MS) {
    runtime.lastDebug = timestamp;
    options.setDebugSnapshot(
      buildDebugSnapshot(runtime, options.metricsRef.current.snapshot()),
    );
  }
}

/** Aims, simulates, paints and records metrics for one frame, then runs the throttled refreshes. */
function runFrame(
  timestamp: number,
  dt: number,
  runtime: Runtime,
  canvas: HTMLCanvasElement,
  options: FrameLoopOptions,
): void {
  const simStart = performance.now();
  const rect = canvas.getBoundingClientRect();
  const size: Viewport = { width: rect.width, height: rect.height };
  const pointer = options.pointerRef.current?.position() ?? null;
  const { player } = runtime.state;
  options.inputRef.current.setAim(
    aimAngle(runtime.camera, size, [player.x, player.y], pointer),
  );
  advanceSimulation(
    runtime,
    dt,
    options.inputRef.current.snapshot(),
    timestamp,
    options.debug,
  );
  if (trackDeath(runtime, timestamp))
    options.setDeath(
      runtime.diedAtMs === null ? null : { diedAtMs: runtime.diedAtMs },
    );
  const drawStart = performance.now();
  const zone = runtime.state.zoneKey
    ? findZoneByKey(runtime.session.index(), runtime.state.zoneKey)
    : null;
  paintCanvas(
    canvas,
    rect,
    runtime.camera,
    buildScene(runtime, zone, pointer, timestamp),
  );
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
