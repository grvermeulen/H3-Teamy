import * as Sentry from "@sentry/nextjs";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCamera } from "@/lib/cityArena/render/camera";
import { createStaticRaster } from "@/lib/cityArena/render/staticRaster";
import {
  createFakeContext,
  createFakeTarget,
} from "@/lib/cityArena/render/testing/fakeContext";
import { createArenaState } from "@/lib/cityArena/sim/arena";
import { createRng } from "@/lib/cityArena/sim/rng";
import { createVehicle } from "@/lib/cityArena/sim/vehicle";
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
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import {
  aimAngle,
  computeHud,
  nearestLandmarkTo,
  useArenaGame,
} from "./useArenaGame";

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

/**
 * Renders the hook with a real (if unattached-to-the-DOM) canvas, and fakes its 2D context —
 * jsdom's own `getContext` returns `null`. Needed only by tests that drive the frame loop
 * manually: `startFrameLoop`'s tick skips `runFrame` (and so the throttled tile-sync/HUD/debug
 * refreshes) entirely when `canvasRef.current` is null, which `renderArenaGame` above leaves it.
 */
function renderArenaGameWithCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => createFakeContext() as unknown as CanvasRenderingContext2D,
  );
  const canvasRef = { current: document.createElement("canvas") };
  return renderHook(() =>
    useArenaGame({ zoneKey: "wageningen", canvasRef, debug: false }),
  );
}

/** Grabs the frame-loop's `tick` callback handed to the mocked `requestAnimationFrame`. */
function getTick(): (timestamp: number) => void {
  return vi.mocked(window.requestAnimationFrame).mock.calls[0][0];
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
});
