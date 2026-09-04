import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapIndex, MapTile } from "@/lib/cityArena/world/mapTypes";
import {
  createFakeContext,
  createFakeTarget,
} from "@/lib/cityArena/render/testing/fakeContext";

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
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) =>
      window.clearTimeout(handle),
    );
  });

  afterEach(() => {
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
    expect(
      screen.getAllByText("Kaart © OpenStreetMap-bijdragers").length,
    ).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Ga naar"), {
      target: { value: "campus" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("arena-hud")).toHaveTextContent("WUR-campus"),
    );
    await act(async () => {
      fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
    });
    expect(onClose).toHaveBeenCalled();
  });
});
