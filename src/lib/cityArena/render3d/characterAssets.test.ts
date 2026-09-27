import * as Sentry from "@sentry/nextjs";
import { BufferGeometry, type SkinnedMesh } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assembleCharacterAssets,
  characterAssetsReady,
  disposeGltfCharacterAssets,
  loadCharacterAssets,
  resetCharacterAssetsForTests,
  type CharacterAssetIo,
  type ParsedGltf,
} from "./characterAssets";
import {
  fixtureFiles,
  fixtureManifest,
  fixtureModelGltf,
  fixtureRigGltf,
} from "./testing/gltfFixture";

/** File bytes that name the fixture file they stand for. */
function bytesOf(file: string): ArrayBuffer {
  return new TextEncoder().encode(file).buffer as ArrayBuffer;
}

/** A server holding the fixture manifest and files, and a parser turning them into fixtures. */
function fakeIo(): CharacterAssetIo {
  const manifest = JSON.stringify(fixtureManifest());
  return {
    fetch: vi.fn(async (url: string) => {
      const file = url.split("/").pop() ?? "";
      const body =
        file === "manifest.json"
          ? new TextEncoder().encode(manifest)
          : bytesOf(file);
      return new Response(body, { status: 200 });
    }),
    parse: vi.fn(async (bytes: ArrayBuffer): Promise<ParsedGltf> => {
      const file = new TextDecoder().decode(bytes);
      return file.startsWith("anim-") ? fixtureRigGltf() : fixtureModelGltf();
    }),
  };
}

/** The one skinned mesh of a scene. */
function meshOf(gltf: ParsedGltf): SkinnedMesh {
  const mesh = gltf.scene.children.find(
    (child) => (child as SkinnedMesh).isSkinnedMesh,
  );
  return mesh as SkinnedMesh;
}

describe("assembleCharacterAssets", () => {
  it("rebuilds normals and a pose-proof culling sphere for every model", () => {
    const manifest = fixtureManifest();
    const files = fixtureFiles(manifest);
    const before = meshOf(files.get("swat.glb") as ParsedGltf).geometry;
    before.computeBoundingSphere();
    const bindRadius = before.boundingSphere?.radius ?? 0;
    const assets = assembleCharacterAssets(manifest, files);
    const mesh = meshOf({ scene: assets.models.swat.scene, animations: [] });
    expect(mesh.geometry.getAttribute("normal")).toBeDefined();
    expect(mesh.geometry.getAttribute("_palette")).toBeDefined();
    expect(mesh.boundingSphere?.radius).toBeGreaterThan(bindRadius);
  });

  it("splits the gait into legs and upper body, and keeps the palette's defaults", () => {
    const assets = assembleCharacterAssets(
      fixtureManifest(),
      fixtureFiles(fixtureManifest()),
    );
    const { men } = assets.rigs;
    expect(men.lower.walk.tracks.map((track) => track.name)).toEqual([
      "Hips.position",
    ]);
    expect(men.upper.walk.tracks.map((track) => track.name)).toEqual([
      "Chest.position",
    ]);
    expect(men.upper.gunIdle.tracks.map((track) => track.name)).toEqual([
      "Chest.position",
    ]);
    expect(men.referenceHeight).toBeCloseTo(1.8);
    expect(assets.models["woman-a"].female).toBe(true);
    expect(assets.models["woman-a"].slots).toContain("Hair");
    expect(assets.models["woman-a"].palette[0]).toBeGreaterThan(0);
  });

  it("names a file the manifest lists but nothing loaded", () => {
    const manifest = fixtureManifest();
    const files = fixtureFiles(manifest);
    files.delete("anim-women.glb");
    expect(() => assembleCharacterAssets(manifest, files)).toThrow(
      /anim-women\.glb/,
    );
  });
});

describe("loadCharacterAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCharacterAssetsForTests();
  });

  afterEach(() => {
    resetCharacterAssetsForTests();
  });

  it("loads once and keeps the characters ready", async () => {
    const io = fakeIo();
    expect(characterAssetsReady()).toBeNull();
    const first = await loadCharacterAssets(io);
    const second = await loadCharacterAssets(io);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(characterAssetsReady()).toBe(first);
    expect(io.fetch).toHaveBeenCalledTimes(18);
  });

  it("leaves a breadcrumb for a network failure and stays procedural for the session", async () => {
    const io = fakeIo();
    vi.mocked(io.fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await loadCharacterAssets(io)).toBeNull();
    expect(await loadCharacterAssets(io)).toBeNull();
    expect(io.fetch).toHaveBeenCalledTimes(1);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(characterAssetsReady()).toBeNull();
  });

  it("reports a missing file as an exception", async () => {
    const io = fakeIo();
    vi.mocked(io.fetch).mockResolvedValueOnce(
      new Response("", { status: 404 }),
    );
    expect(await loadCharacterAssets(io)).toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ area: "characters" }),
      }),
    );
  });

  it("reports a file that will not parse as an exception", async () => {
    const io = fakeIo();
    vi.mocked(io.parse).mockRejectedValueOnce(
      new SyntaxError("Unexpected token"),
    );
    expect(await loadCharacterAssets(io)).toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("frees the models on dispose and loads them again for the next view", async () => {
    const dispose = vi.spyOn(BufferGeometry.prototype, "dispose");
    const io = fakeIo();
    await loadCharacterAssets(io);
    disposeGltfCharacterAssets();
    expect(characterAssetsReady()).toBeNull();
    expect(dispose).toHaveBeenCalled();
    expect(await loadCharacterAssets(io)).not.toBeNull();
    dispose.mockRestore();
  });

  it("throws away a load that lands after a dispose", async () => {
    const io = fakeIo();
    const pending = loadCharacterAssets(io);
    disposeGltfCharacterAssets();
    expect(await pending).toBeNull();
    expect(characterAssetsReady()).toBeNull();
  });
});
