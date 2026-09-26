import { Texture, TextureLoader } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LandmarkLookup } from "../render/drawStatic";
import type { DecodedTile } from "../world/decode";
import {
  WORLD_BUILD_BUDGET_MS,
  createCity3d,
  loadWorldMaterials,
  type CityFrame,
} from "./city3d";
import { createColourRecordingContext } from "./testing/recordingCanvas";
import { createTestMaterials, fixtureTown } from "./testing/cityFixture";
import { SURFACE_KEYS, surfaceUrl } from "./textures";
import { disposeWorldMaterials } from "./worldMaterials";
import { createWorldCells, type StructureView } from "./worldCells";

vi.mock("./worldCells", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./worldCells")>();
  return { ...actual, createWorldCells: vi.fn(actual.createWorldCells) };
});
vi.mock("./worldMaterials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./worldMaterials")>();
  return {
    ...actual,
    disposeWorldMaterials: vi.fn(actual.disposeWorldMaterials),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FOCUS = { x: 64, y: 64 };
const NO_STRUCTURES: readonly StructureView[] = [];

function frameOf(
  landmarks: LandmarkLookup,
  extra: Partial<Omit<CityFrame, "scene">> = {},
): CityFrame {
  return {
    scene: { world: { landmarks } },
    tiles: [fixtureTown()] as readonly DecodedTile[],
    structures: NO_STRUCTURES,
    quality: "auto",
    size: { width: 1280, height: 720 },
    ...extra,
  };
}

/** The world cells the city made, in order. */
function cellsMade(): ReturnType<typeof createWorldCells>[] {
  return vi.mocked(createWorldCells).mock.results.map((result) => result.value);
}

describe("createCity3d", () => {
  it("streams the city on the first frame, dressed by that frame's landmark lookup", () => {
    const landmarks: LandmarkLookup = new Map();
    const materials = createTestMaterials();
    const city = createCity3d(materials);
    expect(createWorldCells).not.toHaveBeenCalled();

    city.update(FOCUS, frameOf(landmarks));

    expect(createWorldCells).toHaveBeenCalledWith(materials, landmarks);
    const [cells] = cellsMade();
    expect(cells!.group.parent).toBe(city.object);
    expect(cells!.group.children.length).toBeGreaterThan(0);
  });

  it("hangs the city under a group at the default render order, as the ground's layering needs", () => {
    const city = createCity3d(createTestMaterials());
    city.update(FOCUS, frameOf(new Map()));

    expect(city.object.renderOrder).toBe(0);
    expect(cellsMade()[0]!.group.renderOrder).toBe(0);
  });

  it("builds out to the quality's view distance within a 4 ms budget", () => {
    expect(WORLD_BUILD_BUDGET_MS).toBe(4);
    const city = createCity3d(createTestMaterials());
    const landmarks: LandmarkLookup = new Map();
    city.update(FOCUS, frameOf(landmarks));
    const [cells] = cellsMade();
    const update = vi.spyOn(cells!, "update");
    const frame = frameOf(landmarks, { quality: "high" });

    city.update(FOCUS, frame);
    city.update(
      FOCUS,
      frameOf(landmarks, { size: { width: 390, height: 800 } }),
    );

    expect(update.mock.calls[0]).toEqual([
      FOCUS,
      frame.tiles,
      frame.structures,
      520,
      WORLD_BUILD_BUDGET_MS,
    ]);
    expect(update.mock.calls[1]![3]).toBe(260);
  });

  it("keeps its cells from frame to frame, and starts again for another session's landmarks", () => {
    const city = createCity3d(createTestMaterials());
    const first: LandmarkLookup = new Map();
    city.update(FOCUS, frameOf(first));
    city.update(FOCUS, frameOf(first));
    expect(createWorldCells).toHaveBeenCalledTimes(1);
    const [old] = cellsMade();
    const dispose = vi.spyOn(old!, "dispose");

    city.update(FOCUS, frameOf(new Map()));

    expect(createWorldCells).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(old!.group.parent).toBeNull();
    expect(cellsMade()[1]!.group.parent).toBe(city.object);
  });

  it("finds the furniture of the built cells, and none before the first frame", () => {
    const city = createCity3d(createTestMaterials());
    const into = [
      { kind: "lamp", x: 0, y: 0, heading: 0 },
    ] as unknown as Parameters<typeof city.furnitureNear>[3];
    expect(city.furnitureNear(30, 58, 2, into)).toEqual([]);

    city.update(FOCUS, frameOf(new Map()));
    const near = city.furnitureNear(30, 58, 2);

    expect(near.map((piece) => piece.kind)).toEqual(["bench"]);
  });

  it("frees its cells and the shared materials on dispose", () => {
    const materials = createTestMaterials();
    const city = createCity3d(materials);
    city.update(FOCUS, frameOf(new Map()));
    const dispose = vi.spyOn(cellsMade()[0]!, "dispose");

    city.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(disposeWorldMaterials).toHaveBeenCalledWith(materials);
  });
});

describe("loadWorldMaterials", () => {
  it("loads every surface's 2D art through three's texture loader", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      // jsdom's getContext returns null; the façades paint on a recording fake (test file only).
      () =>
        createColourRecordingContext() as unknown as CanvasRenderingContext2D,
    );
    const load = vi
      .spyOn(TextureLoader.prototype, "load")
      .mockImplementation(() => new Texture());

    const materials = loadWorldMaterials();

    expect(load.mock.calls.map(([url]) => url).sort()).toEqual(
      SURFACE_KEYS.map(surfaceUrl).sort(),
    );
    expect(materials.surfaces.road.map).toBeInstanceOf(Texture);
  });
});
