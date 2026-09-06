import * as Sentry from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasFactory } from "./canvasTypes";
import { CAR_BODY_COLOURS } from "./palette";
import { createSpriteStore, type ImageLoader } from "./loadSprites";
import { NO_SPRITES } from "./sprites";
import { createFakeTarget } from "./testing/fakeContext";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const manifest = {
  version: 1,
  surfaces: {
    road: { file: "/arena/sprites/road.png", tileMetres: 8, tilePixels: 128 },
    pavement: {
      file: "/arena/sprites/pavement.png",
      tileMetres: 8,
      tilePixels: 128,
    },
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
