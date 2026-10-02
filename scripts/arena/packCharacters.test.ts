import { beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterManifestSchema } from "../../src/lib/cityArena/characterManifest";
import {
  CHARACTER_SOURCES,
  buildManifest,
  characterCredits,
  clipRolesFrom,
  fetchSource,
  isRestChannel,
  partOfMesh,
  sha256Of,
  slotName,
  srgbHexOf,
  unormWeights,
  type CharacterSource,
  type PackedModel,
  type PackedRig,
  type SourceIo,
} from "./packCharacters";

/** The animation names the Quaternius packs ship, as the probe printed them. */
const PACK_CLIPS = [
  "CharacterArmature|Death",
  "CharacterArmature|Gun_Shoot",
  "CharacterArmature|Idle",
  "CharacterArmature|Idle_Gun",
  "CharacterArmature|Idle_Gun_Pointing",
  "CharacterArmature|Idle_Gun_Shoot",
  "CharacterArmature|Idle_Neutral",
  "CharacterArmature|Punch_Left",
  "CharacterArmature|Punch_Right",
  "CharacterArmature|Run",
  "CharacterArmature|Sword_Slash",
  "CharacterArmature|Walk",
];

const BYTES = new Uint8Array([1, 2, 3]);

/** A source pinned to `hash`. */
function pinned(hash: string): CharacterSource {
  return { ...CHARACTER_SOURCES[0], sha256: hash };
}

/** File and network fakes: a cache holding `cached` (or nothing) and a server serving `served`. */
function fakeIo(cached: Uint8Array | null, served: Uint8Array): SourceIo {
  return {
    read: vi.fn(async () => cached),
    write: vi.fn(async () => undefined),
    fetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      bytes: async () => served,
    })),
  };
}

describe("fetchSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads a missing file into the cache when its hash matches", async () => {
    const io = fakeIo(null, BYTES);
    const fetched = await fetchSource(pinned(sha256Of(BYTES)), io, "cache");
    expect(fetched.sha256).toBe(sha256Of(BYTES));
    expect(io.fetch).toHaveBeenCalledWith(
      `https://static.poly.pizza/${CHARACTER_SOURCES[0].uuid}.glb`,
    );
    expect(io.write).toHaveBeenCalledTimes(1);
  });

  it("refuses a download whose hash differs and caches nothing", async () => {
    const io = fakeIo(null, new Uint8Array([9]));
    await expect(
      fetchSource(pinned(sha256Of(BYTES)), io, "cache"),
    ).rejects.toThrow(/does not match/);
    expect(io.write).not.toHaveBeenCalled();
  });

  it("refuses a cached file whose hash differs without downloading", async () => {
    const io = fakeIo(new Uint8Array([9]), BYTES);
    await expect(
      fetchSource(pinned(sha256Of(BYTES)), io, "cache"),
    ).rejects.toThrow(/refusing/);
    expect(io.fetch).not.toHaveBeenCalled();
  });

  it("reports a failed download", async () => {
    const io = fakeIo(null, BYTES);
    vi.mocked(io.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      bytes: async () => BYTES,
    });
    await expect(
      fetchSource(pinned(sha256Of(BYTES)), io, "cache"),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("pins every approved source", () => {
    expect(CHARACTER_SOURCES).toHaveLength(15);
    for (const source of CHARACTER_SOURCES)
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("clipRolesFrom", () => {
  it("picks the pack's clip for every role", () => {
    expect(clipRolesFrom(PACK_CLIPS)).toEqual({
      idle: "Idle",
      walk: "Walk",
      run: "Run",
      death: "Death",
      punch: "Punch_Right",
      gunIdle: "Idle_Gun_Pointing",
      gunShoot: "Gun_Shoot",
      swing: "Sword_Slash",
    });
  });

  it("falls back to the next candidate", () => {
    const names = PACK_CLIPS.filter(
      (name) => !name.endsWith("|Idle_Gun_Pointing"),
    );
    expect(clipRolesFrom(names).gunIdle).toBe("Idle_Gun");
  });

  it("names the role nothing plays", () => {
    const names = PACK_CLIPS.filter((name) => !name.endsWith("|Walk"));
    expect(() => clipRolesFrom(names)).toThrow(/"walk"/);
  });
});

describe("isRestChannel", () => {
  it("drops a scale that never leaves one", () => {
    expect(isRestChannel([1, 1, 1, 1, 1, 1], [1, 1, 1])).toBe(true);
  });

  it("keeps a translation that moves", () => {
    expect(isRestChannel([0, 0, 0, 0, 0.01, 0], [0, 0, 0])).toBe(false);
  });

  it("treats a negated quaternion as the same rotation", () => {
    expect(isRestChannel([0, 0, 0, -1, 0, 0, 0, 1], [0, 0, 0, 1])).toBe(true);
  });
});

describe("slotName", () => {
  it("names the body part of a mesh", () => {
    expect(partOfMesh("Casual2_Head")).toBe("Head");
    expect(partOfMesh("Farmer_Pants")).toBe("Pants");
  });

  it("splits a material shared by the hair and the shoes into slots of their own", () => {
    const parts = new Set(["Head", "Feet"]);
    expect(slotName("Red", "Head", parts)).toBe("Head/Red");
    expect(slotName("Red", "Feet", parts)).toBe("Feet/Red");
  });

  it("keeps one slot for a material on one part, or on the body and legs", () => {
    expect(slotName("Hair", "Head", new Set(["Head"]))).toBe("Hair");
    expect(slotName("Suit", "Legs", new Set(["Legs", "Body"]))).toBe("Suit");
  });
});

describe("unormWeights", () => {
  it("keeps every vertex's weights summing to 255", () => {
    const bytes = unormWeights([0.5, 0.3, 0.2, 0, 1 / 3, 1 / 3, 1 / 3, 0]);
    expect(bytes[0] + bytes[1] + bytes[2] + bytes[3]).toBe(255);
    expect(bytes[4] + bytes[5] + bytes[6] + bytes[7]).toBe(255);
    expect(bytes[0]).toBe(128);
  });
});

describe("srgbHexOf", () => {
  it("encodes linear factors as sRGB", () => {
    expect(srgbHexOf([0, 0.5, 1])).toBe(0x00bcff);
  });
});

/** A packed model of every source. */
function packedModels(): PackedModel[] {
  return CHARACTER_SOURCES.map((entry) => ({
    entry,
    materials: ["Skin", "Shirt"],
    colours: [0xba9c79, 0x223344],
    height: 1.8574123,
    bytes: 1000,
  }));
}

/** Both rigs, playing the pack's clips. */
function packedRigs(): PackedRig[] {
  const clips = clipRolesFrom(PACK_CLIPS);
  return [
    { rig: "men", clips, bytes: 100 },
    { rig: "women", clips, bytes: 100 },
  ];
}

describe("buildManifest", () => {
  it("survives a JSON round trip through the schema the 3D view reads", () => {
    const manifest = buildManifest(packedModels(), packedRigs());
    const reread = CharacterManifestSchema.parse(
      JSON.parse(JSON.stringify(manifest)),
    );
    expect(reread).toEqual(manifest);
    expect(reread.models.swat).toMatchObject({
      file: "swat.glb",
      rig: "men",
      height: 1.8574,
    });
    expect(reread.models["suit-woman"].rig).toBe("women");
    expect(reread.animations.women.file).toBe("anim-women.glb");
  });

  it("refuses a manifest missing a model", () => {
    expect(() =>
      buildManifest(packedModels().slice(1), packedRigs()),
    ).toThrow();
  });
});

describe("characterCredits", () => {
  it("credits every model and both animation files", () => {
    const credits = characterCredits(CHARACTER_SOURCES);
    for (const source of CHARACTER_SOURCES)
      expect(credits).toContain(`| ${source.key}.glb |`);
    expect(credits).toContain("| anim-men.glb |");
    expect(credits).toContain("| anim-women.glb |");
    expect(credits).toContain(
      "[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)",
    );
    expect(credits).toContain("https://poly.pizza/m/sOUciDsoVV");
  });
});
