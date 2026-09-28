import * as Sentry from "@sentry/nextjs";
import { Group, type Mesh } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assembleCarAssets,
  carAssetsReady,
  disposeGltfCarAssets,
  loadCarAssets,
  resetCarAssetsForTests,
  type CarAssetIo,
} from "./carAssets";
import { fixtureCarManifest, fixtureCarScene } from "./testing/carFixture";

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

/** A server holding the fixture manifest and files, and a parser turning them into fixtures. */
function fakeIo(): CarAssetIo {
  const manifest = JSON.stringify(fixtureCarManifest());
  return {
    fetch: vi.fn(async (url: string) => {
      const file = url.split("/").pop() ?? "";
      const body = file === "manifest.json" ? manifest : file;
      return new Response(new TextEncoder().encode(body), { status: 200 });
    }),
    parse: vi.fn(async () => ({ scene: fixtureCarScene() })),
  };
}

describe("loadCarAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCarAssetsForTests();
  });

  afterEach(() => {
    resetCarAssetsForTests();
  });

  it("loads the manifest and every kind's file once", async () => {
    const io = fakeIo();
    const cars = await loadCarAssets(io);
    expect(cars?.cars.police.entry.livery).not.toBeNull();
    expect(carAssetsReady()).toBe(cars);
    expect(io.fetch).toHaveBeenCalledWith("/arena/cars/manifest.json");
    expect(io.parse).toHaveBeenCalledTimes(7);
    await loadCarAssets(io);
    expect(io.parse).toHaveBeenCalledTimes(7);
  });

  it("leaves a breadcrumb for a dropped connection and stays procedural", async () => {
    const io = fakeIo();
    vi.mocked(io.fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await loadCarAssets(io)).toBeNull();
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(await loadCarAssets(fakeIo())).toBeNull();
  });

  it("reports a missing file as an error", async () => {
    const io = fakeIo();
    vi.mocked(io.fetch).mockImplementation(async (url: string) =>
      url.endsWith("manifest.json")
        ? new Response(JSON.stringify(fixtureCarManifest()))
        : new Response("", { status: 404 }),
    );
    expect(await loadCarAssets(io)).toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/HTTP 404/) }),
      { tags: { component: "arena-3d", area: "cars" } },
    );
  });

  it("forgets the cars when disposed, and throws away a load that lands after", async () => {
    await loadCarAssets(fakeIo());
    disposeGltfCarAssets();
    expect(carAssetsReady()).toBeNull();
    const pending = loadCarAssets(fakeIo());
    disposeGltfCarAssets();
    expect(await pending).toBeNull();
    expect(carAssetsReady()).toBeNull();
  });
});

describe("assembleCarAssets", () => {
  it("refuses a file missing its body or a wheel", () => {
    const manifest = fixtureCarManifest();
    const files = new Map(
      Object.values(manifest.cars).map((car) => [
        car.file,
        { scene: car.file === "van.glb" ? new Group() : fixtureCarScene() },
      ]),
    );
    expect(() => assembleCarAssets(manifest, files)).toThrow(/van: no body/);
  });

  it("refuses a wheel without the vertex colours it is drawn in", () => {
    const manifest = fixtureCarManifest();
    const broken = fixtureCarScene();
    const wheel = broken.children.find(
      (child) => child.userData.name === "wheel-back-right",
    ) as Mesh;
    wheel.geometry.deleteAttribute("color");
    const files = new Map(
      Object.values(manifest.cars).map((car) => [
        car.file,
        { scene: car.file === "sport.glb" ? broken : fixtureCarScene() },
      ]),
    );
    expect(() => assembleCarAssets(manifest, files)).toThrow(
      /sport: no coloured wheel-back-right/,
    );
  });
});
