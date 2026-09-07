import * as Sentry from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasFactory } from "./canvasTypes";
import { CAR_BODY_COLOURS } from "./palette";
import { createSpriteStore, type ImageLoader } from "./loadSprites";
import { NO_SPRITES } from "./sprites";
import { createFakeTarget } from "./testing/fakeContext";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

/** One manifest surface entry; every texture ships at the same authored size. */
function surface(name: string) {
  return { file: `/arena/sprites/${name}.png`, tileMetres: 8, tilePixels: 128 };
}

const manifest = {
  version: 1,
  surfaces: {
    road: surface("road"),
    pavement: surface("pavement"),
    water: surface("water"),
    grass: surface("grass"),
    field: surface("field"),
    forest: surface("forest"),
    urban: surface("urban"),
  },
  vehicles: {
    sedan: {
      file: "/arena/sprites/car.png",
      lengthMetres: 4.2,
      widthMetres: 1.8,
      pixelWidth: 58,
      pixelHeight: 134,
    },
  },
  people: {
    player: {
      file: "/arena/sprites/person.png",
      radiusMetres: 0.4,
      pixelSize: 51,
    },
  },
};

/** A `fetch` that answers the manifest request with `body`, or with `status` when not 200. */
function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve({
      ok: status === 200,
      status,
      json: () => Promise.resolve(body),
    }),
  ) as unknown as typeof fetch;
}

const canvasFactory: CanvasFactory = (width, height) =>
  createFakeTarget(width, height);
const loadImage: ImageLoader = () =>
  Promise.resolve(document.createElement("canvas"));

describe("createSpriteStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has no sprites until load resolves", async () => {
    const store = createSpriteStore({
      canvasFactory,
      loadImage,
      fetchImpl: fakeFetch(manifest),
    });
    expect(store.current()).toBe(NO_SPRITES);
    await store.load();
    expect(store.current().road?.tileMetres).toBe(8);
    expect(store.current().pavement?.tilePixels).toBe(128);
  });

  it("loads a texture for water and for every ground kind", async () => {
    const store = createSpriteStore({
      canvasFactory,
      loadImage,
      fetchImpl: fakeFetch(manifest),
    });
    await store.load();
    expect(store.current().water?.tileMetres).toBe(8);
    expect(Object.keys(store.current().ground ?? {}).sort()).toEqual([
      "field",
      "forest",
      "grass",
      "urban",
    ]);
  });

  it("keeps the player on the flat circle when the character art is missing", async () => {
    const failing: ImageLoader = (src) =>
      src.includes("person")
        ? Promise.reject(new Error("missing"))
        : Promise.resolve(document.createElement("canvas"));
    const store = createSpriteStore({
      canvasFactory,
      loadImage: failing,
      fetchImpl: fakeFetch(manifest),
    });
    await expect(store.load()).resolves.toBe(true);
    expect(store.current().player).toBeUndefined();
    expect(store.current().car).toBeDefined();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "sprite", step: "person" },
      }),
    );
  });

  it("drops only the ground texture whose image is missing", async () => {
    const failing: ImageLoader = (src) =>
      src.includes("grass")
        ? Promise.reject(new Error("missing"))
        : Promise.resolve(document.createElement("canvas"));
    const store = createSpriteStore({
      canvasFactory,
      loadImage: failing,
      fetchImpl: fakeFetch(manifest),
    });
    await expect(store.load()).resolves.toBe(true);
    expect(store.current().ground?.grass).toBeUndefined();
    expect(store.current().ground?.forest).toBeDefined();
  });

  it("builds one tinted car sprite per body colour", async () => {
    const store = createSpriteStore({
      canvasFactory,
      loadImage,
      fetchImpl: fakeFetch(manifest),
    });
    await store.load();
    expect(store.current().car?.tinted).toHaveLength(CAR_BODY_COLOURS.length);
  });

  it("fetches the manifest once however often load is called", async () => {
    const fetchImpl = fakeFetch(manifest);
    const store = createSpriteStore({ canvasFactory, loadImage, fetchImpl });
    await Promise.all([store.load(), store.load()]);
    await store.load();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a missing manifest to Sentry and leaves the painters on flat fills", async () => {
    const store = createSpriteStore({
      canvasFactory,
      loadImage,
      fetchImpl: fakeFetch(null, 404),
    });
    await expect(store.load()).resolves.toBe(false);
    expect(store.current()).toBe(NO_SPRITES);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "sprite", step: "manifest" },
      }),
    );
  });

  it("keeps the sprites that did load when one image is missing", async () => {
    const failing: ImageLoader = (src) =>
      src.includes("car")
        ? Promise.reject(new Error("missing"))
        : Promise.resolve(document.createElement("canvas"));
    const store = createSpriteStore({
      canvasFactory,
      loadImage: failing,
      fetchImpl: fakeFetch(manifest),
    });
    await expect(store.load()).resolves.toBe(true);
    expect(store.current().road).toBeDefined();
    expect(store.current().car).toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "sprite", step: "vehicle" },
      }),
    );
  });
});
