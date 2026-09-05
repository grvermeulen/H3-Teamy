import * as Sentry from "@sentry/nextjs";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCamera } from "@/lib/cityArena/render/camera";
import { CROSSHAIR_STROKE } from "@/lib/cityArena/render/palette";
import { createStaticRaster } from "@/lib/cityArena/render/staticRaster";
import {
  createFakeContext,
  createFakeTarget,
  type FakeContext,
} from "@/lib/cityArena/render/testing/fakeContext";
import { createArenaState } from "@/lib/cityArena/sim/arena";
import {
  PLAYER_MAX_HEALTH,
  RESPAWN_DELAY_TICKS,
} from "@/lib/cityArena/sim/damage";
import { createRng } from "@/lib/cityArena/sim/rng";
import { createVehicle } from "@/lib/cityArena/sim/vehicle";
import { nextWeapon, SPAWN_AMMO } from "@/lib/cityArena/sim/weapons";
import { createCollisionGrid } from "@/lib/cityArena/world/collisionGrid";
import type { LoadProgress } from "@/lib/cityArena/world/mapLoader";
import type { MapIndex, MapLandmark } from "@/lib/cityArena/world/mapTypes";
import type { Point } from "@/lib/cityArena/world/projection";
import { decodeRoadGraph } from "@/lib/cityArena/world/roadGraph";
import type {
  WorldReady,
  WorldSession,
} from "@/lib/cityArena/world/worldSession";

// Hoisted so it exists before `vi.mock` below runs (Vitest hoists `vi.mock` calls to the top
// of the module, ahead of ordinary `const` declarations).
const mockCreateWorldSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/cityArena/world/worldSession", () => ({
  createWorldSession: mockCreateWorldSession,
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import {
  aimAngle,
  computeHud,
  nearestLandmarkTo,
  useArenaGame,
} from "./useArenaGame";

/** Wall-clock step (ms) between manually driven frames; matches `MAX_FRAME_S` so each is a full 0.1 s step. */
const FRAME_STEP_MS = 100;
/** Generous bound on frames driven while waiting for a respawn (needs roughly 33 at `FRAME_STEP_MS`; see deathScreen.ts). */
const MAX_RESPAWN_FRAMES = 60;

/** Minimal valid index with no zones: `bootSession` falls back to spawning at `[0, 0]`. */
const testIndex: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
  tileSize: 1000,
  tiles: [],
  zones: [],
  landmarks: [],
};
const testGraph = decodeRoadGraph({
  nodes: [],
  edges: [],
  classes: [],
  names: [],
});
const testReady: WorldReady = { index: testIndex, graph: testGraph };

/** Index with two single-spawn-point zones, so `teleportToZone` moves to a known position. */
const zonedTestIndex: MapIndex = {
  ...testIndex,
  zones: [
    {
      key: "wageningen",
      name: "Wageningen",
      center: [0, 0],
      radius: 4000,
      spawnNodes: [[0, 0]],
      landmarks: [],
    },
    {
      key: "campus",
      name: "Campus",
      center: [4000, 4000],
      radius: 4000,
      spawnNodes: [[4000, 4000]],
      landmarks: [],
    },
  ],
};

/** A world session whose `ready()` stays pending until the returned `resolveReady` runs. */
function createControllableSession(): {
  session: WorldSession;
  resolveReady: (value: WorldReady) => void;
} {
  let settleReady: ((value: WorldReady) => void) | null = null;
  const readyPromise = new Promise<WorldReady>((resolve) => {
    settleReady = resolve;
  });
  // The executor above runs synchronously, so `settleReady` is always set by this point.
  const resolveReady = (value: WorldReady): void => settleReady?.(value);
  const session: WorldSession = {
    ready: () => readyPromise,
    index: () => testIndex,
    graph: () => testGraph,
    collision: createCollisionGrid(),
    raster: createStaticRaster((width, height) =>
      createFakeTarget(width, height),
    ),
    landmarks: () => new Map(),
    update: vi.fn(async () => ({ loaded: 0, total: 0 })),
    tiles: () => [],
    loadedTileRects: () => [],
    hasFailures: () => false,
    dispose: vi.fn(),
  };
  return { session, resolveReady };
}

/** Resolves `session.ready()` with {@link testReady} and flushes the boot promise chain: its own `await`, then the `.then` continuation. */
async function bootReady(
  resolveReady: (value: WorldReady) => void,
): Promise<void> {
  await act(async () => {
    resolveReady(testReady);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * A controllable session whose `session.update` resolves immediately the first time (the
 * boot's own sync) but stays pending on every later call until `settlePendingUpdate` is
 * invoked — for testing that a throttled refresh sync never overlaps itself.
 */
function createDeferredUpdateSession(index: MapIndex): {
  session: WorldSession;
  resolveReady: (value: WorldReady) => void;
  updateCalls: Point[];
  settlePendingUpdate: (progress: LoadProgress) => void;
} {
  const { session, resolveReady } = createControllableSession();
  session.index = () => index;
  const updateCalls: Point[] = [];
  let settleFn: ((progress: LoadProgress) => void) | null = null;
  session.update = vi.fn((centre: Point): Promise<LoadProgress> => {
    updateCalls.push(centre);
    if (updateCalls.length === 1)
      return Promise.resolve({ loaded: 0, total: 0 });
    return new Promise<LoadProgress>((resolve) => {
      settleFn = resolve;
    });
  });
  return {
    session,
    resolveReady,
    updateCalls,
    settlePendingUpdate: (progress) => settleFn?.(progress),
  };
}

/** Renders the hook with a plain (unattached) canvas ref, exactly as the overlay would. */
function renderArenaGame() {
  return renderHook(() =>
    useArenaGame({
      zoneKey: "wageningen",
      canvasRef: useRef<HTMLCanvasElement>(null),
      debug: false,
      reducedMotion: false,
    }),
  );
}

/** Options for {@link renderArenaGameWithCanvas}; omitted fields keep the pre-existing defaults. */
type RenderWithCanvasOptions = { debug?: boolean };

/**
 * Renders the hook with a real (if unattached-to-the-DOM) canvas, and fakes its 2D context —
 * jsdom's own `getContext` returns `null`. Needed only by tests that drive the frame loop
 * manually: `startFrameLoop`'s tick skips `runFrame` (and so the throttled tile-sync/HUD/debug
 * refreshes) entirely when `canvasRef.current` is null, which `renderArenaGame` above leaves it.
 * Every `getContext` call returns the SAME fake context (as a real canvas would), so callers can
 * inspect `fakeContext.calls` across frames; it and the raw `canvas` come back alongside the hook
 * result so a test can dispatch pointer events and assert on paint calls.
 */
function renderArenaGameWithCanvas(options: RenderWithCanvasOptions = {}) {
  const fakeContext = createFakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    fakeContext as unknown as CanvasRenderingContext2D,
  );
  const canvas = document.createElement("canvas");
  // `canvasRef` must keep one stable identity across re-renders: `useArenaBoot` and
  // `useArenaInput`'s effects list it as a dependency, so a fresh object every render would
  // re-run them (and so re-boot the session) on every re-render instead of once on mount.
  const canvasRef = { current: canvas };
  const hook = renderHook(() =>
    useArenaGame({
      zoneKey: "wageningen",
      canvasRef,
      debug: options.debug ?? false,
    }),
  );
  return { ...hook, canvas, fakeContext };
}

/**
 * Wires a fresh controllable session into the mocked factory, renders the hook on a real canvas,
 * and boots it — the setup every debug-seam test needing real frames otherwise repeats.
 */
async function bootArenaWithCanvas(
  options: RenderWithCanvasOptions = {},
): Promise<ReturnType<typeof renderArenaGameWithCanvas>> {
  const { session, resolveReady } = createControllableSession();
  mockCreateWorldSession.mockReturnValue(session);
  const rendered = renderArenaGameWithCanvas(options);
  await bootReady(resolveReady);
  return rendered;
}

/** Grabs the frame-loop's `tick` callback handed to the mocked `requestAnimationFrame`. */
function getTick(): (timestamp: number) => void {
  return vi.mocked(window.requestAnimationFrame).mock.calls[0][0];
}

/** True once the fake context has drawn the mouse crosshair (`drawCrosshair` in drawProjectiles.ts). */
function hasCrosshairStroke(fakeContext: FakeContext): boolean {
  const crosshairStroke = `stroke(${CROSSHAIR_STROKE}`;
  return fakeContext.calls.some((call) => call.startsWith(crosshairStroke));
}

/**
 * Calls `tick` with timestamps `FRAME_STEP_MS` apart, starting after `fromMs`, until `isDone`
 * reports true or `MAX_RESPAWN_FRAMES` frames have run — whichever comes first, so a regression
 * that stops the state from ever satisfying `isDone` fails the caller's own assertion instead of
 * hanging the test.
 */
function driveFramesUntil(
  tick: (timestamp: number) => void,
  fromMs: number,
  isDone: () => boolean,
): void {
  let timestamp = fromMs;
  for (let frame = 0; frame < MAX_RESPAWN_FRAMES && !isDone(); frame++) {
    timestamp += FRAME_STEP_MS;
    act(() => tick(timestamp));
  }
}

describe("useArenaGame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("ignores a boot that resolves after unmount instead of resurrecting the runtime", async () => {
    const { session, resolveReady } = createControllableSession();
    mockCreateWorldSession.mockReturnValue(session);

    const { unmount } = renderArenaGame();
    unmount();

    await act(async () => {
      resolveReady(testReady);
      // Flush the boot promise chain: the `ready()` await, then the `.then` continuation.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(session.update).not.toHaveBeenCalled();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("boots normally when not cancelled, and disposes exactly once on unmount", async () => {
    const { session, resolveReady } = createControllableSession();
    mockCreateWorldSession.mockReturnValue(session);

    const { result, unmount } = renderArenaGame();

    await act(async () => {
      resolveReady(testReady);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.phase).toBe("playing");
    expect(session.update).toHaveBeenCalledTimes(1);
    expect(session.dispose).not.toHaveBeenCalled();

    unmount();
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it("sets the phase to error and reports to Sentry when ready() rejects", async () => {
    const session: WorldSession = {
      ready: vi.fn(() => Promise.reject(new Error("boot failed"))),
      index: () => testIndex,
      graph: () => testGraph,
      collision: createCollisionGrid(),
      raster: createStaticRaster((width, height) =>
        createFakeTarget(width, height),
      ),
      landmarks: () => new Map(),
      update: vi.fn(async () => ({ loaded: 0, total: 0 })),
      tiles: () => [],
      loadedTileRects: () => [],
      hasFailures: () => false,
      dispose: vi.fn(),
    };
    mockCreateWorldSession.mockReturnValue(session);

    const { result } = renderArenaGame();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.phase).toBe("error");
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { area: "arena", kind: "boot" } }),
    );
  });

  it("does not start a second tile sync while one is in flight, and runs exactly one follow-up sync at the newer position", async () => {
    const { session, resolveReady, updateCalls, settlePendingUpdate } =
      createDeferredUpdateSession(zonedTestIndex);
    mockCreateWorldSession.mockReturnValue(session);

    const { result } = renderArenaGameWithCanvas();

    await act(async () => {
      resolveReady({ index: zonedTestIndex, graph: testGraph });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("playing");
    expect(updateCalls).toHaveLength(1); // the boot's own sync

    const tick = getTick();

    act(() => tick(500));
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[1]).toEqual([0, 0]);

    act(() => tick(1000));
    expect(updateCalls).toHaveLength(2); // still in flight: no second call issued

    act(() => result.current.teleportToZone("campus"));
    act(() => tick(1001));
    expect(updateCalls).toHaveLength(2); // the teleport only requests a follow-up

    await act(async () => {
      settlePendingUpdate({ loaded: 9, total: 9 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateCalls).toHaveLength(3); // exactly one follow-up
    expect(updateCalls[2]).toEqual([1000, 1000]); // the post-teleport position
  });

  it("clears the failed flag once a later sync reports the loader has recovered", async () => {
    const { session, resolveReady } = createControllableSession();
    let currentlyFailing = true;
    session.hasFailures = () => currentlyFailing;
    session.update = vi
      .fn()
      .mockResolvedValueOnce({ loaded: 8, total: 9 })
      .mockImplementationOnce(async () => {
        currentlyFailing = false;
        return { loaded: 9, total: 9 };
      });
    mockCreateWorldSession.mockReturnValue(session);

    const { result } = renderArenaGameWithCanvas();

    await act(async () => {
      resolveReady(testReady);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("playing");
    expect(result.current.failed).toBe(true);

    await act(async () => {
      getTick()(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.failed).toBe(false);
  });
});

describe("nearestLandmarkTo", () => {
  const near: MapLandmark = {
    key: "near",
    name: "Dichtbij",
    style: "cafe",
    center: [40, 40], // 10, 10 m
    tile: { x: 0, y: 0 },
  };
  const far: MapLandmark = {
    key: "far",
    name: "Veraf",
    style: "cafe",
    center: [4000, 4000], // 1000, 1000 m
    tile: { x: 1, y: 1 },
  };

  it("picks the landmark whose centre is closest, straight-line, to the point", () => {
    expect(nearestLandmarkTo([far, near], [0, 0])).toBe(near);
    expect(nearestLandmarkTo([near, far], [0, 0])).toBe(near);
  });

  it("picks the other landmark once the point is closer to it instead", () => {
    expect(nearestLandmarkTo([near, far], [2000, 2000])).toBe(far);
  });
});

describe("computeHud and aimAngle", () => {
  it("reports vitals on foot and the car speed while driving", () => {
    const state = createArenaState(
      { index: testIndex, graph: testGraph, seed: 1, zone: null },
      createRng(1),
    );
    const session = { index: () => testIndex, tiles: () => [] };
    expect(computeHud(session, state)).toMatchObject({
      zoneName: null,
      health: 100,
      weapon: "pistol",
      speedMps: null,
      inVehicle: false,
    });
    const car = { ...createVehicle(9, "sport", [0, 0], 0, 0), velocityX: 10 };
    const driving = {
      ...state,
      vehicles: [car],
      player: { ...state.player, vehicleId: 9 },
    };
    expect(computeHud(session, driving)).toMatchObject({
      speedMps: 10,
      inVehicle: true,
    });
  });

  it("aims from the player toward the mouse position", () => {
    const camera = createCamera([0, 0], 8);
    const viewport = { width: 200, height: 100 };
    expect(aimAngle(camera, viewport, [0, 0], null)).toBeNull();
    expect(aimAngle(camera, viewport, [0, 0], [100, 90])).toBeCloseTo(
      Math.PI / 2,
    );
    expect(aimAngle(camera, viewport, [0, 0], [180, 50])).toBeCloseTo(0);
  });
});

describe("debug hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("installs window.__arena in debug mode and removes it on unmount", async () => {
    const { session, resolveReady } = createControllableSession();
    mockCreateWorldSession.mockReturnValue(session);
    const { unmount } = renderHook(() =>
      useArenaGame({
        zoneKey: "wageningen",
        canvasRef: useRef<HTMLCanvasElement>(null),
        debug: true,
        reducedMotion: false,
      }),
    );
    await act(async () => {
      resolveReady(testReady);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.__arena?.getState()?.tick).toBe(0);
    window.__arena?.dispatch({ fire: true }, 2);
    expect(window.__arena?.getViolations()).toBe(0);
    unmount();
    expect(window.__arena).toBeUndefined();
  });

  it("switches the held weapon once, stamps and clears a death, and hides the crosshair while dead", async () => {
    const { result, canvas, fakeContext } = await bootArenaWithCanvas({
      debug: true,
    });
    expect(result.current.phase).toBe("playing");
    const tick = getTick();
    // A live mouse position, so a crosshair would be drawn if the death fix below didn't hide it.
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerType: "mouse",
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );

    // (a) held for 3 ticks, the edge-trigger contract (detectEdges in arena.ts) switches once.
    window.__arena?.dispatch({ weaponNext: true }, 3);
    act(() => tick(0));
    act(() => tick(FRAME_STEP_MS));
    expect(window.__arena?.getState()?.player.weapon).toBe(
      nextWeapon("pistol", SPAWN_AMMO),
    );
    expect(hasCrosshairStroke(fakeContext)).toBe(true);
    fakeContext.calls.length = 0;

    // (b) damage() stamps the death on the very next frame, at that frame's clock, and hides
    // the crosshair; (c) it clears once the tick passes the respawn delay (damage.ts).
    window.__arena?.damage(PLAYER_MAX_HEALTH);
    const diedAtTick = window.__arena?.getState()?.player.diedAtTick ?? 0;
    act(() => tick(2 * FRAME_STEP_MS));
    expect(result.current.death).toEqual({ diedAtMs: 2 * FRAME_STEP_MS });
    expect(hasCrosshairStroke(fakeContext)).toBe(false);

    const respawnTick = diedAtTick + RESPAWN_DELAY_TICKS;
    driveFramesUntil(
      tick,
      2 * FRAME_STEP_MS,
      () => (window.__arena?.getState()?.tick ?? 0) >= respawnTick,
    );
    expect(result.current.death).toBeNull();

    // None of the frames above broke an invariant.
    expect(window.__arena?.getViolations()).toBe(0);
  });

  it("reports a broken invariant to Sentry once, even though it recurs every later frame", async () => {
    const { result } = await bootArenaWithCanvas({ debug: true });
    expect(result.current.phase).toBe("playing");
    const tick = getTick();

    // No live input ever produces NaN; this is the cheapest way to put the state into a shape
    // checkInvariants (invariants.ts) rejects, so the once-per-message dedupe can be exercised.
    // The break is permanent (stepPlayer's dead-zone branch only overwrites facing/speed), so the
    // same message recurs on every later tick without any further help from this test.
    window.__arena?.dispatch({ move: [Number.NaN, Number.NaN] }, 1);
    act(() => tick(0));
    act(() => tick(FRAME_STEP_MS));
    act(() => tick(2 * FRAME_STEP_MS));

    expect(window.__arena?.getViolations()).toBeGreaterThan(0);
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
      "Arena invariant: player position is not finite",
      { level: "warning", tags: { area: "arena", kind: "invariant" } },
    );
  });
});
