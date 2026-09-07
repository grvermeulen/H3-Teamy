"use client";

import { localPlayer } from "@/lib/cityArena/sim/players";
import * as Sentry from "@sentry/nextjs";
import type { RefObject } from "react";
import type {
  FrameMetrics,
  MetricsSnapshot,
} from "@/lib/cityArena/debugMetrics";
import type { InputState } from "@/lib/cityArena/input/inputState";
import type { PointerAim } from "@/lib/cityArena/input/pointerAim";
import {
  DRIVING_LOOK_AHEAD_MAX_M,
  LOOK_AHEAD_MAX_M,
  createCamera,
  screenToWorld,
  speedZoomLevel,
  updateCamera,
  visibleRect,
  zoomLevelForViewport,
  type Camera,
  type Viewport,
  type ZoomLevel,
} from "@/lib/cityArena/render/camera";
import {
  deathScreenPhase,
  type DeathScreenPhase,
} from "@/lib/cityArena/render/deathScreen";
import { renderScene, type Scene } from "@/lib/cityArena/render/renderScene";
import {
  createRadarRoadIndex,
  nearbyRadarRoads,
  RADAR_RANGE_M,
  type RadarRoadIndex,
  type RadarSnapshot,
} from "@/lib/cityArena/render/radar";
import {
  createArenaState,
  occupiedVehicle,
  stepArena,
  teleportArenaPlayer,
  type ArenaWorld,
} from "@/lib/cityArena/sim/arena";
import { checkInvariants } from "@/lib/cityArena/sim/invariants";
import { SIM_STEP_S } from "@/lib/cityArena/sim/player";
import { createRng, seedFromString } from "@/lib/cityArena/sim/rng";
import { forwardSpeed } from "@/lib/cityArena/sim/vehicle";
import { currentWantedLevel } from "@/lib/cityArena/sim/wanted";
import { zoneSecondsLeft } from "@/lib/cityArena/sim/zoneRule";
import type {
  ArenaPlayerState,
  ArenaState,
  WorldInput,
} from "@/lib/cityArena/sim/types";
import { saveArenaSettings } from "@/lib/cityArena/storage";
import type { LoadProgress } from "@/lib/cityArena/world/mapLoader";
import type {
  MapIndex,
  MapLandmark,
  MapZone,
  ZoneKey,
} from "@/lib/cityArena/world/mapTypes";
import type { Point } from "@/lib/cityArena/world/projection";
import { findPath, pathLength } from "@/lib/cityArena/world/roadGraph";
import type { WorldSession } from "@/lib/cityArena/world/worldSession";
import {
  createArenaSound,
  type ArenaSound,
  type AudioContextFactory,
} from "@/lib/cityArena/audio/sound";
import {
  findZoneByKey,
  landmarkCentreMetres,
  pickSpawn,
} from "@/lib/cityArena/world/zone";
import type { EntityCounts } from "./ArenaDebugOverlay";
import {
  buildRadarSnapshot,
  computeHud,
  radarZone,
  type ArenaHud,
} from "./arenaHud";

/**
 * The arena runtime and frame-loop layer used by `useArenaGame`: the mutable per-frame
 * `Runtime`, its creation, the fixed-step simulation advance, the render, and the throttled
 * tile-sync/HUD/debug refreshes. Nothing here is a React hook — it is plain "run the simulation
 * and paint" machinery that `useArenaGame.ts` drives from `useEffect`.
 */

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
/** Maximum distance (metres) a landmark's centre may sit from the road graph and still snap onto it. */
const LANDMARK_SNAP_DISTANCE_M = 200;
/** Milliseconds per second, for converting between frame timestamps and simulation seconds. */
const MS_PER_SECOND = 1000;

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

/** A debug input that replaces the live one for a number of steps. */
type InjectedInput = { input: WorldInput; ticksLeft: number };

/** Mutable per-frame state shared by the boot, input and frame-loop hooks. */
export type Runtime = {
  session: WorldSession;
  state: ArenaState;
  camera: Camera;
  /** Zoom the viewport width asks for; the live camera may sit one step wider while driving. */
  baseZoom: ZoomLevel;
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
  sound: ArenaSound;
  soundEnabled: boolean;
  radarRoadIndex: RadarRoadIndex;
  disposed: boolean;
};

/** True while async frame-loop callbacks may still publish state. */
export function canApplyRuntimeUpdate(
  runtime: Pick<Runtime, "disposed">,
): boolean {
  return !runtime.disposed;
}

/** Reports a failure through Sentry, tagged so arena issues are easy to filter. */
export function reportArenaError(error: unknown, kind: string): void {
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
    player: localPlayer(state),
    peds: state.peds,
    cops: state.cops,
    pickups: state.pickups,
    vehicles: state.vehicles,
    bullets: state.bullets,
    effects: state.effects,
    tick: state.tick,
    // Hidden during the death screen: the push-in transform would otherwise draw it up to 8%
    // off from the physical cursor (spec §7's push-in tops out at 1.08×).
    aimScreen: runtime.diedAtMs === null ? aimScreen : null,
    pushIn: deathPhase(runtime, nowMs)?.pushIn ?? 1,
    carSprite: session.sprites().car,
    playerSprite: session.sprites().player,
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
  const playerPoint: Point = [
    localPlayer(runtime.state).x,
    localPlayer(runtime.state).y,
  ];
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

/** Moves the player to a seeded spawn node of `zone` and remembers it as the last-visited zone. */
export function applyTeleport(runtime: Runtime, zone: MapZone): void {
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
export function createRuntime(
  session: WorldSession,
  index: MapIndex,
  zone: MapZone | null,
  viewportWidthPx: number,
  reducedMotion: boolean,
  soundEnabled = true,
  audioContextFactory?: AudioContextFactory,
): Runtime {
  const seed = seedFromString(
    `${SESSION_SEED_PREFIX}:${zone?.key ?? "none"}:${Date.now()}`,
  );
  const random = createRng(seed);
  const state = createArenaState(
    { index, graph: session.graph(), seed, zone },
    random,
  );
  const baseZoom = zoomLevelForViewport(viewportWidthPx);
  return {
    session,
    state,
    camera: createCamera(
      [localPlayer(state).x, localPlayer(state).y],
      baseZoom,
    ),
    baseZoom,
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
    sound: createArenaSound(audioContextFactory, soundEnabled),
    soundEnabled,
    radarRoadIndex: createRadarRoadIndex(
      session.graph().nodes,
      session.graph().edges,
    ),
    disposed: false,
  };
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
    player: localPlayer(runtime.state),
    routeMetres: routeToNearestLandmark(runtime),
    entities: {
      vehicles: runtime.state.vehicles.length,
      bullets: runtime.state.bullets.length,
      effects: runtime.state.effects.length,
      peds: runtime.state.peds.length,
      cops: runtime.state.cops.length,
      traffic: runtime.state.traffic.length,
      pickups: runtime.state.pickups.length,
      wantedLevel: currentWantedLevel(runtime.state),
      zoneSecondsLeft: zoneSecondsLeft(
        localPlayer(runtime.state),
        runtime.state.tick,
      ),
      eventCount: runtime.state.events.length,
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
  const dead = localPlayer(runtime.state).diedAtTick !== null;
  if (dead === (runtime.diedAtMs !== null)) return false;
  runtime.diedAtMs = dead ? nowMs : null;
  return true;
}

/**
 * The camera for the next frame: eased toward `target` with the driving or walking look-ahead
 * cap, then re-zoomed for the current speed. Pure so the zoom rule can be tested without booting
 * a runtime.
 */
export function nextCamera(
  camera: Camera,
  baseZoom: ZoomLevel,
  target: Point,
  velocity: Point,
  dt: number,
  driving: boolean,
): Camera {
  const eased = updateCamera(
    camera,
    target,
    velocity,
    dt,
    driving ? DRIVING_LOOK_AHEAD_MAX_M : LOOK_AHEAD_MAX_M,
  );
  const speedMps = Math.hypot(velocity[0], velocity[1]);
  return {
    ...eased,
    zoom: speedZoomLevel(baseZoom, speedMps, camera.zoom),
  };
}

/** Eases the camera after the player or their car and re-zooms it for the speed. */
function followPlayer(runtime: Runtime, dt: number): void {
  const player = localPlayer(runtime.state);
  const car = occupiedVehicle(runtime.state);
  const velocity: Point = car
    ? [car.velocityX, car.velocityY]
    : [
        Math.cos(player.facing) * player.speed,
        Math.sin(player.facing) * player.speed,
      ];
  runtime.camera = nextCamera(
    runtime.camera,
    runtime.baseZoom,
    [player.x, player.y],
    velocity,
    dt,
    car !== null,
  );
}

/** Absorbs `dt` (slowed by the death screen's time scale) in fixed steps, then follows the player. */
function advanceSimulation(
  runtime: Runtime,
  dt: number,
  input: WorldInput,
  nowMs: number,
  debug: boolean,
  viewport: Viewport,
): void {
  runtime.accumulator += dt * (deathPhase(runtime, nowMs)?.timeScale ?? 1);
  const world: ArenaWorld = {
    collision: runtime.session.collision,
    index: runtime.session.index(),
    graph: runtime.session.graph(),
    viewRect: visibleRect(runtime.camera, viewport),
  };
  let steps = 0;
  while (runtime.accumulator >= SIM_STEP_S && steps < MAX_SIM_STEPS_PER_FRAME) {
    const stepInput = nextInput(runtime, input);
    if (
      stepInput.move[0] !== 0 ||
      stepInput.move[1] !== 0 ||
      stepInput.fire ||
      stepInput.enter ||
      stepInput.weaponNext
    )
      runtime.sound.unlock();
    // Offline this client is the only player, so the tick carries exactly one input. Plan 3b
    // replaces this with the host's collected inputs from every member of the room.
    runtime.state = stepArena(
      runtime.state,
      new Map([[localPlayer(runtime.state).id, stepInput]]),
      SIM_STEP_S,
      world,
      runtime.random,
    );
    runtime.sound.handleEvents(runtime.state.events);
    const car = occupiedVehicle(runtime.state);
    runtime.sound.updateEngine(
      car ? Math.abs(forwardSpeed(car)) : 0,
      car !== null &&
        !car.wrecked &&
        localPlayer(runtime.state).boardingTicksLeft === 0,
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
export type FrameLoopOptions = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  runtimeRef: RefObject<Runtime | null>;
  inputRef: RefObject<InputState>;
  pointerRef: RefObject<PointerAim | null>;
  metricsRef: RefObject<FrameMetrics>;
  debug: boolean;
  setProgress: (progress: LoadProgress) => void;
  setFailed: (failed: boolean) => void;
  setHud: (hud: ArenaHud) => void;
  setRadar: (radar: RadarSnapshot) => void;
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
  if (!canApplyRuntimeUpdate(runtime)) return;
  runtime.tileSyncPending = true;
  const player = localPlayer(runtime.state);
  runtime.session
    .update([player.x, player.y])
    .then(
      (progress) => {
        if (!canApplyRuntimeUpdate(runtime)) return;
        options.setProgress(progress);
        options.setFailed(runtime.session.hasFailures());
      },
      (error: unknown) => reportArenaError(error, "tile-sync"),
    )
    .finally(() => {
      if (!canApplyRuntimeUpdate(runtime)) return;
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
    options.setHud(
      computeHud(runtime.session, runtime.state, runtime.soundEnabled),
    );
    const zone = radarZone(runtime.session.index(), runtime.state);
    options.setRadar(
      buildRadarSnapshot(
        runtime.state,
        zone,
        nearbyRadarRoads(
          runtime.radarRoadIndex,
          [localPlayer(runtime.state).x, localPlayer(runtime.state).y],
          RADAR_RANGE_M,
        ),
      ),
    );
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
  const player = localPlayer(runtime.state);
  options.inputRef.current.setAim(
    aimAngle(runtime.camera, size, [player.x, player.y], pointer),
  );
  advanceSimulation(
    runtime,
    dt,
    options.inputRef.current.snapshot(),
    timestamp,
    options.debug,
    size,
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
export function startFrameLoop(options: FrameLoopOptions): () => void {
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
