import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStaticRaster } from "@/lib/cityArena/render/staticRaster";
import { createFakeTarget } from "@/lib/cityArena/render/testing/fakeContext";
import { createCollisionGrid } from "@/lib/cityArena/world/collisionGrid";
import type { MapIndex } from "@/lib/cityArena/world/mapTypes";
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

import { useArenaGame } from "./useArenaGame";

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

/** Renders the hook with a plain (unattached) canvas ref, exactly as the overlay would. */
function renderArenaGame() {
  return renderHook(() =>
    useArenaGame({
      zoneKey: "wageningen",
      canvasRef: useRef<HTMLCanvasElement>(null),
      debug: false,
    }),
  );
}

describe("useArenaGame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
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
});
