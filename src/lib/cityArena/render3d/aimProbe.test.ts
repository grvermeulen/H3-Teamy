import { PerspectiveCamera } from "three";
import { describe, expect, it, vi } from "vitest";
import type { Rect } from "../mapBuild/geometry";
import type { Point } from "../world/projection";
import {
  CHARACTER_RADIUS_M,
  PROBE_STEP_M,
  probeAim,
  type AimCharacter,
  type AimPoint,
  type AimVehicle,
  type AimWorld,
} from "./aimProbe";

// Every Vector3 made through the module counts, so a probe that makes one shows up.
const constructed = vi.hoisted(() => ({ vectors: 0 }));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class CountedVector3 extends actual.Vector3 {
    constructor(x?: number, y?: number, z?: number) {
      super(x, y, z);
      constructed.vectors += 1;
    }
  }
  return { ...actual, Vector3: CountedVector3 };
});

const RANGE_M = 100;

/** A building for the fake world: its footprint and height. */
type Block = { ring: Point[]; height: number };

/** A camera at `(x, y)` and `height`, looking along `yaw` and `pitch` (radians). */
function cameraAt(
  x: number,
  y: number,
  height: number,
  yaw = 0,
  pitch = 0,
): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 2000);
  camera.position.set(x, height, y);
  camera.lookAt(
    x + Math.cos(yaw) * Math.cos(pitch),
    height + Math.sin(pitch),
    y + Math.sin(yaw) * Math.cos(pitch),
  );
  return camera;
}

/** A standing person at `(x, y)`. */
function person(x: number, y: number, extra: Partial<AimCharacter> = {}) {
  return { x, y, dead: false, self: false, ...extra };
}

/** A square footprint from `(minX, minY)`, `side` metres wide, `height` high. */
function block(
  minX: number,
  minY: number,
  side: number,
  height: number,
): Block {
  const ring: Point[] = [
    [minX, minY],
    [minX + side, minY],
    [minX + side, minY + side],
    [minX, minY + side],
  ];
  return { ring, height };
}

/** A world of the given parts; every visit hands out all its buildings and is recorded. */
function worldOf(parts: {
  characters?: AimCharacter[];
  vehicles?: AimVehicle[];
  buildings?: Block[];
}): AimWorld & { visited: Rect[] } {
  const visited: Rect[] = [];
  return {
    characters: parts.characters ?? [],
    vehicles: parts.vehicles ?? [],
    buildings: {
      visit(area, onBuilding) {
        visited.push({ ...area });
        for (const { ring, height } of parts.buildings ?? [])
          onBuilding(ring, height);
      },
    },
    visited,
  };
}

/** A fresh aim point to write into. */
function blankPoint(): AimPoint {
  return { x: 0, y: 0, height: 0, distance: 0, target: "sky" };
}

describe("probeAim", () => {
  it("hits a person 20 m ahead at about 20 m", () => {
    const point = probeAim(
      cameraAt(0, 0, 1.3),
      worldOf({ characters: [person(20, 0)] }),
      RANGE_M,
      blankPoint(),
    );
    expect(point.target).toBe("character");
    expect(point.distance).toBeCloseTo(20 - CHARACTER_RADIUS_M, 3);
    expect(point.x).toBeCloseTo(20 - CHARACTER_RADIUS_M, 3);
    expect(point.y).toBeCloseTo(0, 6);
    expect(point.height).toBeCloseTo(1.3, 6);
  });

  it("hits the wall standing in front of a person first", () => {
    const point = probeAim(
      cameraAt(0, 0, 1.3),
      worldOf({
        characters: [person(20, 0)],
        buildings: [block(10, -2, 4, 6)],
      }),
      RANGE_M,
      blankPoint(),
    );
    expect(point.target).toBe("building");
    expect(point.distance).toBeCloseTo(10, 6);
  });

  it("aims at the sky at full range when the ray meets nothing", () => {
    const pitch = 0.5;
    const point = probeAim(
      cameraAt(0, 0, 1.6, 0, pitch),
      worldOf({ buildings: [block(10, 20, 5, 6)] }),
      RANGE_M,
      blankPoint(),
    );
    expect(point.target).toBe("sky");
    expect(point.distance).toBeCloseTo(RANGE_M, 6);
    expect(point.height).toBeCloseTo(1.6 + Math.sin(pitch) * RANGE_M, 4);
  });

  it("meets the ground where the camera's height and pitch put it", () => {
    const pitch = -0.35;
    const height = 1.65;
    const point = probeAim(
      cameraAt(0, 0, height, Math.PI / 2, pitch),
      worldOf({}),
      RANGE_M,
      blankPoint(),
    );
    expect(point.target).toBe("ground");
    expect(point.distance).toBeCloseTo(height / Math.sin(-pitch), 4);
    expect(point.y).toBeCloseTo(height / Math.tan(-pitch), 4);
    expect(point.height).toBeCloseTo(0, 6);
  });

  it("looks straight through your own body and your own car", () => {
    const point = probeAim(
      cameraAt(0, 0, 1.65),
      worldOf({
        characters: [person(0, 0, { self: true })],
        vehicles: [
          {
            x: 1,
            y: 0,
            heading: 0,
            length: 4.2,
            width: 1.8,
            height: 1.5,
            own: true,
          },
        ],
      }),
      RANGE_M,
      blankPoint(),
    );
    expect(point.target).toBe("sky");
  });

  it("hits a car turned across the ray on its flank", () => {
    const car: AimVehicle = {
      x: 15,
      y: 0,
      heading: Math.PI / 2,
      length: 4.2,
      width: 1.8,
      height: 1.5,
      own: false,
    };
    const point = probeAim(
      cameraAt(0, 0, 1),
      worldOf({ vehicles: [car] }),
      RANGE_M,
      blankPoint(),
    );
    expect(point.target).toBe("vehicle");
    expect(point.distance).toBeCloseTo(15 - 0.9, 6);
  });

  it("passes over a body at chest height and hits it looking down", () => {
    const body = person(6, 0, { dead: true });
    const level = probeAim(
      cameraAt(0, 0, 1.3),
      worldOf({ characters: [body] }),
      RANGE_M,
      blankPoint(),
    );
    expect(level.target).toBe("sky");
    const down = probeAim(
      cameraAt(0, 0, 1.3, 0, -Math.atan2(1.2, 6)),
      worldOf({ characters: [body] }),
      RANGE_M,
      blankPoint(),
    );
    expect(down.target).toBe("character");
  });

  it("lands on a flat roof seen from above", () => {
    const point = probeAim(
      cameraAt(0, 0, 20, 0, -Math.atan2(20 - 6, 12)),
      worldOf({ buildings: [block(10, -5, 10, 6)] }),
      RANGE_M,
      blankPoint(),
    );
    expect(point.target).toBe("building");
    expect(point.height).toBeCloseTo(6, 4);
    expect(point.x).toBeCloseTo(12, 4);
  });

  it("ignores what stands between the camera and the shooter and measures the reach from them", () => {
    const shooter = { x: 0, y: 0 };
    const point = probeAim(
      cameraAt(-3.6, 0, 1.3),
      worldOf({ characters: [person(-1.5, 0)] }),
      40,
      blankPoint(),
      shooter,
    );
    expect(point.target).toBe("sky");
    expect(point.x).toBeCloseTo(40, 4);
  });

  it("aims just past the shooter when the ray meets the ground before reaching them", () => {
    const point = probeAim(
      cameraAt(-3.6, 0.5, 3, 0, -1),
      worldOf({ characters: [person(3, 0.5)] }),
      40,
      blankPoint(),
      { x: 0, y: 0 },
    );
    expect(point.target).toBe("ground");
    expect(point.x).toBeCloseTo(0, 4);
  });

  it("walks the ray in steps, asking only for the buildings along it", () => {
    const world = worldOf({ buildings: [] });
    probeAim(cameraAt(100, 200, 1.6), world, RANGE_M, blankPoint());
    expect(world.visited).toHaveLength(Math.ceil(RANGE_M / PROBE_STEP_M));
    for (const { minX, minY, maxX, maxY } of world.visited) {
      expect(minX).toBeGreaterThanOrEqual(100);
      expect(maxX).toBeLessThanOrEqual(100 + RANGE_M);
      expect(maxX - minX).toBeLessThanOrEqual(PROBE_STEP_M);
      expect(minY).toBeCloseTo(200, 6);
      expect(maxY).toBeCloseTo(200, 6);
    }
  });

  it("writes into the point it is handed and makes no vectors, probe after probe", () => {
    const camera = cameraAt(0, 0, 1.6, 0.3, -0.1);
    const world = worldOf({
      characters: [person(20, 5), person(30, -4, { dead: true })],
      buildings: [block(40, -10, 8, 9)],
    });
    const out = blankPoint();
    probeAim(camera, world, RANGE_M, out);
    const before = constructed.vectors;
    for (let probe = 0; probe < 1000; probe += 1)
      expect(probeAim(camera, world, RANGE_M, out)).toBe(out);
    expect(constructed.vectors).toBe(before);
  });
});
