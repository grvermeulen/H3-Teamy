import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAR_KINDS,
  CarManifestSchema,
} from "../../src/lib/cityArena/carManifest";
import { VEHICLE_KINDS } from "../../src/lib/cityArena/sim/vehicle";
import { SWATCH } from "./carAtlas";
import { fixtureAtlas, fixtureCar } from "./carFixture";
import { triangleCount } from "./carGeometry";
import { liveryOf } from "./carMeasure";
import {
  CAR_KIT,
  CAR_SOURCES,
  buildCarManifest,
  carCredits,
  fetchCarKit,
  packCarGeometry,
  splitGlb,
  type CarSource,
} from "./packCars";
import { sha256Of, type SourceIo } from "./packCharacters";

const BYTES = new Uint8Array([1, 2, 3, 4]);

/** A cache holding `cached` (or nothing) and a server answering with `served`. */
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

describe("fetchCarKit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads the kit once, checks its hash and caches it", async () => {
    const io = fakeIo(null, BYTES);
    const fetched = await fetchCarKit(io, "cache", sha256Of(BYTES));
    expect(fetched.sha256).toBe(sha256Of(BYTES));
    expect(io.fetch).toHaveBeenCalledWith(CAR_KIT.url);
    expect(io.write).toHaveBeenCalledTimes(1);
  });

  it("reads a cached kit without downloading", async () => {
    const io = fakeIo(BYTES, BYTES);
    await fetchCarKit(io, "cache", sha256Of(BYTES));
    expect(io.fetch).not.toHaveBeenCalled();
  });

  it("refuses an archive whose hash moved", async () => {
    const io = fakeIo(null, new Uint8Array([9]));
    await expect(fetchCarKit(io, "cache", sha256Of(BYTES))).rejects.toThrow(
      /refusing/,
    );
    expect(io.write).not.toHaveBeenCalled();
  });

  it("reports a failed download", async () => {
    const io = fakeIo(null, BYTES);
    vi.mocked(io.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      bytes: async () => BYTES,
    });
    await expect(fetchCarKit(io, "cache", sha256Of(BYTES))).rejects.toThrow(
      /HTTP 404/,
    );
  });

  it("pins the approved archive", () => {
    expect(CAR_KIT.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(CAR_KIT.url).toBe(
      "https://kenney.nl/media/pages/assets/car-kit/1a312ec241-1775131960/kenney_car-kit.zip",
    );
  });
});

describe("splitGlb", () => {
  it("reads a GLB's JSON and binary chunks", () => {
    const json = new TextEncoder().encode('{"asset":{}}');
    const bin = new Uint8Array([7, 7, 7, 7]);
    const glb = new Uint8Array(12 + 8 + 12 + 8 + 4);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(12, json.length, true);
    view.setUint32(16, 0x4e4f534a, true);
    glb.set(json, 20);
    view.setUint32(32, bin.length, true);
    view.setUint32(36, 0x004e4942, true);
    glb.set(bin, 40);
    const split = splitGlb(glb);
    expect(split.json).toEqual({ asset: {} });
    expect([...split.bin]).toEqual([7, 7, 7, 7]);
  });

  it("refuses bytes that are not a GLB", () => {
    expect(() => splitGlb(new Uint8Array(40))).toThrow(/not a GLB/);
  });
});

describe("CAR_SOURCES", () => {
  it("packs every Kit kind once, and only vehicle kinds", () => {
    expect(CAR_SOURCES.map((source) => source.kind).sort()).toEqual(
      [...CAR_KINDS].sort(),
    );
    for (const kind of CAR_KINDS) expect(VEHICLE_KINDS).toContain(kind);
  });
});

/** The fixture car, packed as a police car. */
const POLICE: CarSource = {
  kind: "police",
  model: "fixture",
  title: "Fixture",
  paint: SWATCH.redPaint,
  lightBar: true,
  livery: true,
};

describe("packCarGeometry", () => {
  const car = packCarGeometry(fixtureCar(), POLICE, fixtureAtlas());

  it("measures the model in the game's frame, on the ground", () => {
    expect(car.entry.size).toEqual([2.62, 1.3, 1.5]);
    expect(car.entry.source).toBe("fixture");
  });

  it("finds four wheels on the ground, the front pair steering", () => {
    expect(car.entry.wheels).toHaveLength(4);
    for (const wheel of car.entry.wheels) {
      expect(wheel.radius).toBeCloseTo(0.3, 6);
      expect(wheel.at[1]).toBeCloseTo(0.3, 6);
      expect(wheel.steers).toBe(wheel.at[0] > 0);
    }
    const frontLeft = car.entry.wheels.find(
      (wheel) => wheel.node === "wheel-front-left",
    );
    expect(frontLeft?.at[2]).toBeLessThan(0);
    expect(frontLeft?.at[0]).toBeGreaterThan(0);
  });

  it("finds two headlamps facing forward and two tail lamps facing back", () => {
    const heads = car.entry.lamps.filter((lamp) => !lamp.tail);
    const tails = car.entry.lamps.filter((lamp) => lamp.tail);
    expect(heads).toHaveLength(2);
    expect(tails).toHaveLength(2);
    for (const lamp of heads) expect(lamp.facing).toBe(1);
    for (const lamp of tails) expect(lamp.facing).toBe(-1);
    expect(heads[0].at[0]).toBeCloseTo(1.31, 4);
  });

  it("finds the front plate and no rear one", () => {
    expect(car.entry.plates.front?.face).toBeCloseTo(1.31, 4);
    expect(car.entry.plates.front?.height).toBeCloseTo(0.5, 4);
    expect(car.entry.plates.rear).toBeNull();
  });

  it("measures the flank between the arches for the livery", () => {
    expect(car.entry.livery?.side).toBeCloseTo(0.7, 4);
    expect(car.entry.livery?.y).toEqual([0.3, 1.2]);
    expect(car.entry.livery?.x).toEqual([-0.625, 0.625]);
  });

  it("adds the lamps a model lacks", () => {
    const lamps = packCarGeometry(
      fixtureCar(),
      {
        ...POLICE,
        addedLamps: [{ at: [0, 1, 1.3], size: [0.1, 0.1, 0.02], tail: false }],
      },
      fixtureAtlas(),
    );
    expect(triangleCount(lamps.roles.head.positions)).toBe(36);
  });
});

describe("liveryOf", () => {
  it("is null when no paint faces the side between the arches", () => {
    const wheels = packCarGeometry(fixtureCar(), POLICE, fixtureAtlas()).entry
      .wheels;
    const roof = { positions: [0, 1, 0, 0, 1, 1, 1, 1, 0], colours: [] };
    expect(liveryOf(roof, wheels)).toBeNull();
  });
});

describe("buildCarManifest", () => {
  it("survives a JSON round trip through the schema the 3D view reads", () => {
    const cars = CAR_SOURCES.map((source) => ({
      ...packCarGeometry(
        fixtureCar(),
        { ...POLICE, ...source },
        fixtureAtlas(),
      ),
      source,
    }));
    const manifest = buildCarManifest(cars);
    expect(
      CarManifestSchema.parse(JSON.parse(JSON.stringify(manifest))),
    ).toEqual(manifest);
    expect(manifest.cars.sedan.file).toBe("sedan.glb");
  });

  it("refuses a manifest missing a kind", () => {
    const one = packCarGeometry(fixtureCar(), POLICE, fixtureAtlas());
    expect(() => buildCarManifest([one])).toThrow();
  });
});

describe("carCredits", () => {
  it("credits every packed file to Kenney under CC0", () => {
    const credits = carCredits(CAR_SOURCES);
    for (const source of CAR_SOURCES)
      expect(credits).toContain(`| ${source.kind}.glb |`);
    expect(credits).toContain(
      "[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)",
    );
    expect(credits).toContain("https://kenney.nl/assets/car-kit");
  });
});
