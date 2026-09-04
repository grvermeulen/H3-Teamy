import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import type { MapIndex, MapTile } from "@/lib/cityArena/world/mapTypes";
import {
  createFakeContext,
  createFakeTarget,
} from "@/lib/cityArena/render/testing/fakeContext";

/** Frame cap for the mocked `requestAnimationFrame` loop (see `beforeEach`), matching the pattern
 *  in `src/components/spaceInvaders/SpaceInvadersGame.test.tsx`: enough frames for the HUD/tile
 *  throttles to fire at least once, without ever looping forever inside a test. */
const MAX_MOCKED_ANIMATION_FRAMES = 12;

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -8000, minY: -8000, maxX: 24000, maxY: 24000 },
  tileSize: 8000,
  tiles: [],
  zones: [
    {
      key: "wageningen",
      name: "Wageningen centrum",
      center: [0, 0],
      radius: 2000,
      spawnNodes: [[0, 0]],
      landmarks: [],
    },
    {
      key: "campus",
      name: "WUR-campus",
      center: [8000, 8000],
      radius: 2000,
      spawnNodes: [[8000, 8000]],
      landmarks: [],
    },
  ],
  landmarks: [],
};
for (let y = 0; y < 4; y++)
  for (let x = 0; x < 4; x++)
    index.tiles.push({ x, y, file: `tile_${x}_${y}.json`, bytes: 1 });
const emptyTile = (x: number, y: number): MapTile => ({
  x,
  y,
  roads: [
    { points: [-40, 0, 40, 0], roadClass: "residential", name: "Hoogstraat" },
  ],
  buildings: [],
  ground: [],
  water: [],
});

const fetchImpl = vi.fn<typeof fetch>(async (input) => {
  const url = String(input);
  if (url.endsWith("index.json"))
    return new Response(JSON.stringify(index), { status: 200 });
  if (url.endsWith("roads.json"))
    return new Response(
      JSON.stringify({
        nodes: [0, 0, 400, 0],
        edges: [0, 1, 0, -1, 0, 400],
        classes: ["residential"],
        names: [],
      }),
      { status: 200 },
    );
  const match = /tile_(\d+)_(\d+)\.json$/.exec(url);
  return new Response(
    JSON.stringify(
      match ? emptyTile(Number(match[1]), Number(match[2])) : null,
    ),
    { status: match ? 200 : 404 },
  );
});

vi.mock("@/lib/cityArena/render/canvasTypes", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/cityArena/render/canvasTypes")>();
  return {
    ...original,
    createDomCanvasFactory: () => (width: number, height: number) =>
      createFakeTarget(width, height),
  };
});
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import CityArenaOverlay from "./CityArenaOverlay";

describe("CityArenaOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchImpl);
    // jsdom does not implement matchMedia; the overlay's touch-control detection needs a stub
    // (same pattern as src/components/spaceInvaders/SpaceInvadersGame.test.tsx).
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      // jsdom's canvas getContext returns null; the fake only implements the RasterContext
      // subset the renderer needs, so a cast is unavoidable here (test file only).
      () => createFakeContext() as unknown as CanvasRenderingContext2D,
    );
    // Runs each frame as a microtask (capped) instead of a real 16ms timer, so the frame loop
    // settles without any real waits (same pattern as SpaceInvadersGame.test.tsx).
    let rafCount = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback): number => {
        rafCount += 1;
        if (rafCount <= MAX_MOCKED_ANIMATION_FRAMES) {
          queueMicrotask(() => callback(performance.now() + rafCount * 16));
        }
        return rafCount;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads the world, shows the HUD with the zone and street, teleports and closes", async () => {
    const onClose = vi.fn();
    render(<CityArenaOverlay zone="wageningen" onClose={onClose} />);
    expect(screen.getByRole("status")).toHaveTextContent("Kaart laden…");
    await waitFor(
      () =>
        expect(screen.getByTestId("arena-hud")).toHaveTextContent(
          "Wageningen centrum",
        ),
      { timeout: 3000 },
    );
    await waitFor(
      () =>
        expect(screen.getByTestId("arena-hud")).toHaveTextContent("Hoogstraat"),
      { timeout: 3000 },
    );
    expect(screen.getByLabelText("Ga naar")).toHaveValue("wageningen");
    expect(
      screen.getAllByText("Kaart © OpenStreetMap-bijdragers").length,
    ).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Ga naar"), {
      target: { value: "campus" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("arena-hud")).toHaveTextContent("WUR-campus"),
    );
    expect(screen.getByLabelText("Ga naar")).toHaveValue("campus");
    await act(async () => {
      fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables the zone picker until the world finishes booting, then lets it teleport", async () => {
    render(<CityArenaOverlay zone="wageningen" onClose={vi.fn()} />);
    expect(screen.getByLabelText("Ga naar")).toBeDisabled();

    await waitFor(() =>
      expect(screen.getByTestId("arena-hud")).toHaveTextContent(
        "Wageningen centrum",
      ),
    );
    expect(screen.getByLabelText("Ga naar")).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Ga naar"), {
      target: { value: "campus" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("arena-hud")).toHaveTextContent("WUR-campus"),
    );
  });

  it("shows the Dutch error message and reports the boot failure to Sentry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(null, { status: 404 })),
    );
    render(<CityArenaOverlay zone="wageningen" onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Kon geen verbinding maken, probeer het later opnieuw",
      ),
    );
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { area: "arena", kind: "boot" } }),
    );
  });

  it("shows a Dutch warning in the HUD bar once playing when a tile failed to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("index.json"))
          return new Response(JSON.stringify(index), { status: 200 });
        if (url.endsWith("roads.json"))
          return new Response(
            JSON.stringify({
              nodes: [0, 0, 400, 0],
              edges: [0, 1, 0, -1, 0, 400],
              classes: ["residential"],
              names: [],
            }),
            { status: 200 },
          );
        if (url.endsWith("tile_0_0.json"))
          return new Response(null, { status: 404 });
        const match = /tile_(\d+)_(\d+)\.json$/.exec(url);
        return new Response(
          JSON.stringify(
            match ? emptyTile(Number(match[1]), Number(match[2])) : null,
          ),
          { status: match ? 200 : 404 },
        );
      }),
    );
    render(<CityArenaOverlay zone="wageningen" onClose={vi.fn()} />);
    await waitFor(
      () =>
        expect(screen.getByTestId("arena-hud")).toHaveTextContent(
          "Kaart kon niet volledig laden",
        ),
      { timeout: 3000 },
    );
  });
});
