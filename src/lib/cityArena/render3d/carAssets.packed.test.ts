import { readFileSync } from "node:fs";
import path from "node:path";
import { Box3, Mesh, Points, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAR_KINDS, CarManifestSchema } from "../carManifest";
import { lengthOf, widthOf } from "../sim/vehicle";
import { assembleCarAssets, type CarAssets } from "./carAssets";
import { disposeGltfVehicleParts } from "./gltfVehicle";
import { buildVehicleModel, vehicleHeight } from "./vehicleModels";

/** The packed cars, as committed. */
const CARS_DIR = path.resolve("public/arena/cars");
/** The simulation's footprint may be missed by this share at most (spec §8). */
const FOOTPRINT_TOLERANCE = 0.02;
/**
 * Along the body a little more: wheels stretch round by the height's scale, so the tractor, whose
 * big rear wheels are its back end, stops about 10 cm short of its 4 m.
 */
const LENGTH_TOLERANCE = 0.03;

/** Draw calls: one per material group of a multi-material mesh, one per other mesh or points. */
function drawCallsOf(root: Object3D): number {
  let calls = 0;
  root.traverse((node) => {
    if (node instanceof Mesh)
      calls += Array.isArray(node.material) ? node.geometry.groups.length : 1;
    else if (node instanceof Points) calls += 1;
  });
  return calls;
}

/** The box round a model's meshes. */
function meshSize(root: Object3D): Vector3 {
  root.updateMatrixWorld(true);
  const box = new Box3();
  root.traverse((node) => {
    if (node instanceof Mesh) box.expandByObject(node);
  });
  return box.getSize(new Vector3());
}

/** Reads and parses every packed file the way the 3D view does. */
async function loadPacked(): Promise<CarAssets> {
  const manifest = CarManifestSchema.parse(
    JSON.parse(readFileSync(path.join(CARS_DIR, "manifest.json"), "utf8")),
  );
  const loader = new GLTFLoader();
  const files = new Map<string, { scene: Object3D }>();
  for (const car of Object.values(manifest.cars)) {
    const bytes = readFileSync(path.join(CARS_DIR, car.file));
    // A copy in this realm: GLTFLoader tells binary from JSON with `instanceof ArrayBuffer`.
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    files.set(car.file, await loader.parseAsync(buffer, ""));
  }
  return assembleCarAssets(manifest, files);
}

describe("the packed Kenney cars", () => {
  let cars: CarAssets;

  beforeAll(async () => {
    cars = await loadPacked();
  });

  afterAll(() => {
    disposeGltfVehicleParts();
  });

  it.each(CAR_KINDS)(
    "build a %s at the simulation's footprint and height",
    (kind) => {
      const size = meshSize(buildVehicleModel(kind, 0, cars).root);
      expect(Math.abs(size.x / lengthOf(kind) - 1)).toBeLessThanOrEqual(
        LENGTH_TOLERANCE,
      );
      expect(Math.abs(size.z / widthOf(kind) - 1)).toBeLessThanOrEqual(
        FOOTPRINT_TOLERANCE,
      );
      expect(Math.abs(size.y / vehicleHeight(kind) - 1)).toBeLessThanOrEqual(
        FOOTPRINT_TOLERANCE,
      );
    },
  );

  it.each(CAR_KINDS)(
    "give a %s its paint, detail and both kinds of lamp",
    (kind) => {
      const { root, lamps, wheels } = buildVehicleModel(kind, 0, cars);
      const body = root.getObjectByName("body") as Mesh;
      const groups = body.geometry.groups.map((group) => group.count);
      expect(groups).toHaveLength(4);
      for (const count of groups) expect(count).toBeGreaterThan(0);
      expect(lamps.tailSlot).toBe(3);
      expect(lamps.lamps.filter((lamp) => !lamp.tail)).toHaveLength(2);
      expect(lamps.lamps.filter((lamp) => lamp.tail)).toHaveLength(2);
      expect(wheels.filter((wheel) => wheel.steers)).toHaveLength(2);
    },
  );

  it.each(CAR_KINDS)(
    "draw a %s in no more calls than its procedural model",
    (kind) => {
      expect(
        drawCallsOf(buildVehicleModel(kind, 0, cars).root),
      ).toBeLessThanOrEqual(drawCallsOf(buildVehicleModel(kind, 0).root));
    },
  );

  it("gives the police car its light bar, and plates to all but the tractor", () => {
    for (const kind of CAR_KINDS) {
      const { entry } = cars.cars[kind];
      expect(buildVehicleModel(kind, 0, cars).lightBar !== null).toBe(
        kind === "police",
      );
      expect(entry.plates.front !== null && entry.plates.rear !== null).toBe(
        kind !== "tractor",
      );
    }
    expect(cars.cars.police.entry.livery).not.toBeNull();
  });
});
