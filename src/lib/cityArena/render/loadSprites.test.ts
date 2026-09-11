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
    bus: {
      file: "/arena/sprites/bus.png",
      lengthMetres: 12,
      widthMetres: 2.5,
      pixelWidth: 80,
      pixelHeight: 384,
      tint: false,
    },
  },
  people: {
    player: {
      file: "/arena/sprites/person.png",
      radiusMetres: 0.4,
      pixelSize: 51,
      frames: 8,
    },
    ped1: {
      file: "/arena/sprites/ped1.png",
      radiusMetres: 0.4,
      pixelSize: 51,
      frames: 8,
    },
  },
  props: {
    treeLarge: {
      file: "/arena/sprites/tree-large.png",
      lengthMetres: 10,
      widthMetres: 10,
      pixelWidth: 160,
      pixelHeight: 160,
    },
    bench: {
      file: "/arena/sprites/furniture-bench.png",
      lengthMetres: 1.8,
      widthMetres: 0.6,
      pixelWidth: 58,
      pixelHeight: 19,
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
/** A decoded image wide enough for every strip the manifest names. */
const loadImage: ImageLoader = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  return Promise.resolve(canvas);
};

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

  it("loads every kind's art, tinting only what the manifest says is tintable, and every look", async () => {
    const store = createSpriteStore({
      canvasFactory,
      loadImage,
      fetchImpl: fakeFetch(manifest),
    });
    await store.load();
    const sprites = store.current();
    expect(sprites.vehicles?.sedan).toBe(sprites.car);
    expect(sprites.vehicles?.bus?.tinted).toEqual([]);
    expect(sprites.vehicles?.bus?.base).toBeDefined();
    expect(sprites.people?.player).toBe(sprites.player);
    expect(sprites.people?.ped1?.frames).toBe(8);
  });

  it("clamps a strip to the frames its file holds and reports the stale file", async () => {
    const store = createSpriteStore({
      canvasFactory,
      fetchImpl: fakeFetch(manifest),
      loadImage: (src) => {
        const canvas = document.createElement("canvas");
        canvas.width = src.includes("person.png") ? 51 : 1024;
        return Promise.resolve(canvas);
      },
    });
    await store.load();
    expect(store.current().player?.frames).toBe(1);
    expect(store.current().people?.ped1?.frames).toBe(8);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ kind: "sprite", step: "strip" }),
      }),
    );
  });

  it("loads the props the manifest has, with their metre footprints", async () => {
    const store = createSpriteStore({
      canvasFactory,
      loadImage,
      fetchImpl: fakeFetch(manifest),
    });
    await store.load();
    const props = store.current().props;
    expect(props?.treeLarge?.lengthMetres).toBe(10);
    expect(props?.bench?.widthMetres).toBe(0.6);
    expect(props?.lamp).toBeUndefined();
  });

  it("keeps the kinds and looks whose art did load when one image is missing", async () => {
    const store = createSpriteStore({
      canvasFactory,
      fetchImpl: fakeFetch(manifest),
      loadImage: (src) =>
        src.includes("bus") || src.includes("ped1")
          ? Promise.reject(new Error("missing"))
          : loadImage(src),
    });
    await store.load();
    expect(store.current().vehicles?.bus).toBeUndefined();
    expect(store.current().vehicles?.sedan).toBeDefined();
    expect(store.current().people?.ped1).toBeUndefined();
    expect(store.current().people?.player).toBeDefined();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ area: "arena", kind: "sprite" }),
      }),
    );
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
