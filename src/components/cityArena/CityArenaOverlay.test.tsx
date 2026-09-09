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

/** Opens the overlay and steps past the lobby into the match, which is what these tests cover. */
function renderOverlay(onClose: () => void): void {
  render(
    <CityArenaOverlay
      entry={{ kind: "new", zone: "wageningen" }}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /oefenen|start potje/i }));
}

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

/** These tests are about the playfield, not the netcode, so the room is a connected stub. */
/** One object for the life of the file, so the memos keyed on `room.crew` keep their identity. */
vi.mock("./useArenaRoom", () => {
  const room = {
    status: "ready",
    connection: "connected",
    roomCode: "7K4M2Q",
    clientId: "me",
    clockOffsetMs: 0,
    transport: () => null,
    zone: "wageningen",
    crew: [{ clientId: "me", seat: 0, name: "Jij", isHost: true, isYou: true }],
    hostClientId: "me",
    isHost: true,
    failure: null,
    reportHostLost: vi.fn(),
    leave: vi.fn(),
  };
  return { useArenaRoom: () => room };
});

import {
  ARENA_SETTINGS_KEY,
  ARENA_TOUCH_TIP_KEY,
} from "@/lib/cityArena/storage";
import { HEALTH_LABEL } from "./ArenaVitals";
import CityArenaOverlay from "./CityArenaOverlay";

describe("CityArenaOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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
    renderOverlay(onClose);
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
    // Escape opens the menu (spec §7); leaving the potje from it is what closes the overlay.
    await act(async () => {
      fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
    });
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Potje verlaten" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("preloads the death-screen artwork once the overlay mounts", async () => {
    renderOverlay(vi.fn());
    await waitFor(() =>
      expect(screen.getByTestId("arena-hud")).toHaveTextContent(
        "Wageningen centrum",
      ),
    );
    const link = document.head.querySelector('link[rel="preload"][as="image"]');
    expect(link?.getAttribute("href")).toMatch(
      /\/branding\/wasted-screen\.webp$/,
    );
  });

  it("disables the zone picker until the world finishes booting, then lets it teleport", async () => {
    renderOverlay(vi.fn());
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
    renderOverlay(vi.fn());
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
    renderOverlay(vi.fn());
    await waitFor(
      () =>
        expect(screen.getByTestId("arena-hud")).toHaveTextContent(
          "Kaart kon niet volledig laden",
        ),
      { timeout: 3000 },
    );
  });

  it("shows the vitals once playing and no death overlay or touch buttons on desktop", async () => {
    renderOverlay(vi.fn());
    await waitFor(() =>
      expect(screen.getByTestId("arena-hud")).toHaveTextContent(
        "Wageningen centrum",
      ),
    );
    expect(screen.getByLabelText(HEALTH_LABEL)).toHaveAttribute("value", "100");
    expect(screen.getByTestId("arena-weapon")).toHaveTextContent("Pistool ∞");
    expect(screen.queryByTestId("death-overlay")).toBeNull();
    expect(screen.queryByTestId("arena-touch-buttons")).toBeNull();
    expect(screen.getByLabelText("GTA H3 speelveld").className).toContain(
      "cursor-none",
    );
    expect(screen.getByLabelText("Radar")).toBeInTheDocument();
    expect(screen.getByLabelText("Geluid")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Geluid"));
    expect(screen.getByLabelText("Geluid")).not.toBeChecked();
  });

  it("shows the touch buttons next to the stick on coarse pointers", async () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query.includes("pointer: coarse"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    renderOverlay(vi.fn());
    await waitFor(() =>
      expect(screen.getByTestId("arena-hud")).toHaveTextContent(
        "Wageningen centrum",
      ),
    );
    expect(screen.getByTestId("touch-stick-surface")).toBeInTheDocument();
    // Twin-stick by default: the aim stick fires, so there is no Schieten button (spec §7).
    expect(screen.getByTestId("touch-aim-surface")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schieten" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Instappen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wapen" })).toBeInTheDocument();
    expect(screen.getByText(/Sleep links/)).toBeInTheDocument();
    // The first-run tip shows once, and Begrepen puts it away for good.
    await waitFor(() =>
      expect(screen.getByRole("note")).toHaveTextContent(/richten/),
    );
    fireEvent.click(screen.getByRole("button", { name: "Begrepen" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(localStorage.getItem(ARENA_TOUCH_TIP_KEY)).toBe("1");
  });

  it("shows a fire button instead of the aim stick with Enkele stick, and no tip once read", async () => {
    localStorage.setItem(
      ARENA_SETTINGS_KEY,
      JSON.stringify({ twinStick: false, forceLayout: "mobile" }),
    );
    localStorage.setItem(ARENA_TOUCH_TIP_KEY, "1");
    renderOverlay(vi.fn());
    await waitFor(() =>
      expect(screen.getByTestId("arena-hud")).toHaveTextContent(
        "Wageningen centrum",
      ),
    );
    // Forced to the phone layout on a fine pointer: the touch controls show anyway.
    expect(screen.getByTestId("touch-stick-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("touch-aim-surface")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Schieten" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });
});
