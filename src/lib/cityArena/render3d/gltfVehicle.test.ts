import {
  Box3,
  Color,
  Mesh,
  MeshPhongMaterial,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAR_KINDS } from "../carManifest";
import { lengthOf, widthOf } from "../sim/vehicle";
import { disposeGltfVehicleParts } from "./gltfVehicle";
import { fixtureCarAssets } from "./testing/carFixture";
import {
  bodyColour,
  buildVehicleModel,
  lensMaterial,
  vehicleHeight,
} from "./vehicleModels";
import { charredMaterial, glowMaterial } from "./vehicleParts";
import { TAIL_LIGHT } from "./vehicleShapes";
import { PLATE_LOOKS } from "./vehicleTrim";
import {
  createVehicle3d,
  createVehicleFactory,
  type CarAssetSource,
  type Vehicle3dInput,
} from "./vehicles3d";

/** The simulation's footprint may be missed by this share at most (spec §8). */
const FOOTPRINT_TOLERANCE = 0.02;

/** A parked, intact car with its lights off. */
const PARKED: Vehicle3dInput = {
  speed: 0,
  steer: 0,
  wrecked: false,
  siren: false,
  tick: 0,
  health: 100,
  turretYaw: null,
  dt: 1 / 60,
};

/** The box round a model's meshes: its lamps' flares hang a few centimetres off its ends. */
function sizeOf(root: Object3D): { box: Box3; size: Vector3 } {
  root.updateMatrixWorld(true);
  const box = new Box3();
  root.traverse((node) => {
    if (node instanceof Mesh) box.expandByObject(node);
  });
  return { box, size: box.getSize(new Vector3()) };
}

function bodyOf(root: Object3D): Mesh {
  const body = root.getObjectByName("body");
  if (!(body instanceof Mesh)) throw new Error("no body");
  return body;
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

describe("buildVehicleModel from the Kit", () => {
  const cars = fixtureCarAssets();

  afterEach(() => {
    disposeGltfVehicleParts();
    vi.restoreAllMocks();
  });

  it.each(CAR_KINDS)(
    "fits a %s to the simulation's footprint and height",
    (kind) => {
      const { box, size } = sizeOf(buildVehicleModel(kind, 0, cars).root);
      const error = (actual: number, expected: number): number =>
        Math.abs(actual - expected) / expected;
      expect(error(size.x, lengthOf(kind))).toBeLessThanOrEqual(
        FOOTPRINT_TOLERANCE,
      );
      expect(error(size.z, widthOf(kind))).toBeLessThanOrEqual(
        FOOTPRINT_TOLERANCE,
      );
      expect(error(size.y, vehicleHeight(kind))).toBeLessThanOrEqual(
        FOOTPRINT_TOLERANCE,
      );
      expect(box.min.y).toBeCloseTo(0, 3);
    },
  );

  it("puts four round wheels on the ground, the front pair steering", () => {
    const { wheels } = buildVehicleModel("sedan", 0, cars);
    expect(wheels).toHaveLength(4);
    for (const wheel of wheels) {
      expect(wheel.pivot.position.y).toBeCloseTo(wheel.radius, 5);
      expect(wheel.steers).toBe(wheel.pivot.position.x > 0);
      const size = new Box3()
        .setFromObject(wheel.spinner)
        .getSize(new Vector3());
      expect(size.x).toBeCloseTo(size.y, 5);
    }
  });

  it("spins the wheels with speed and turns only the front pair", () => {
    const vehicle = createVehicle3d("sedan", 0, cars);
    const wheels = vehicle.object.getObjectsByProperty("name", "wheel");
    vehicle.update({ ...PARKED, speed: 10, steer: 1, dt: 0.1 });
    for (const wheel of wheels) expect(wheel.rotation.z).not.toBe(0);
    const pivots = vehicle.object.getObjectsByProperty("name", "wheel-pivot");
    const turned = pivots.filter((pivot) => pivot.rotation.y !== 0);
    expect(turned).toHaveLength(2);
    for (const pivot of turned) expect(pivot.position.x).toBeGreaterThan(0);
  });

  it("tints the paint only, one shared material per colour, the geometry shared", () => {
    const green = bodyOf(buildVehicleModel("sedan", 2, cars).root);
    const red = bodyOf(buildVehicleModel("sedan", 3, cars).root);
    const [greenPaint, ...greenRest] = materialsOf(green);
    const [redPaint, ...redRest] = materialsOf(red);
    expect(greenPaint).toBeInstanceOf(MeshPhongMaterial);
    expect((greenPaint as MeshPhongMaterial).color.getHex()).toBe(
      new Color(bodyColour("sedan", 2)).getHex(),
    );
    expect(redPaint).not.toBe(greenPaint);
    expect(redRest).toEqual(greenRest);
    expect(red.geometry).toBe(green.geometry);
    expect(bodyOf(buildVehicleModel("van", 2, cars).root).material).not.toBe(
      green.material,
    );
  });

  it("mounts yellow plates front and back, and none where the Kit has none", () => {
    const plate = new Color(PLATE_LOOKS.modern.plate);
    const ends = (
      kind: "sedan" | "tractor",
    ): { front: boolean; rear: boolean } => {
      const body = bodyOf(buildVehicleModel(kind, 0, cars).root);
      const colours = body.geometry.getAttribute("color");
      const positions = body.geometry.getAttribute("position");
      const found = { front: false, rear: false };
      for (let index = 0; index < colours.count; index += 1) {
        if (Math.abs(colours.getX(index) - plate.r) > 1e-3) continue;
        if (Math.abs(colours.getY(index) - plate.g) > 1e-3) continue;
        if (positions.getX(index) > 0) found.front = true;
        else found.rear = true;
      }
      return found;
    };
    expect(ends("sedan")).toEqual({ front: true, rear: true });
    expect(ends("tractor")).toEqual({ front: true, rear: false });
  });

  it("lights the brake lamps and flashes the police light bar", () => {
    const police = createVehicle3d("police", 0, cars);
    police.update({ ...PARKED, siren: true, braking: true, tick: 0 });
    const materials = materialsOf(bodyOf(police.object));
    expect(materials[3]).toBe(glowMaterial(TAIL_LIGHT));
    const left = police.object.getObjectByName("light-bar-left") as Mesh;
    const right = police.object.getObjectByName("light-bar-right") as Mesh;
    expect(left.material).toBe(lensMaterial("left", true));
    expect(right.material).toBe(lensMaterial("right", false));
    expect(buildVehicleModel("sedan", 0, cars).lightBar).toBeNull();
  });

  it("chars a wreck and restores it when reused", () => {
    const vehicle = createVehicle3d("pickup", 1, cars);
    vehicle.update({ ...PARKED, wrecked: true });
    vehicle.object.traverse((node) => {
      if (node instanceof Mesh) expect(node.material).toBe(charredMaterial());
    });
    vehicle.update(PARKED);
    expect(materialsOf(bodyOf(vehicle.object))).toHaveLength(4);
  });

  it("frees its own flares but not the geometry its kind shares", () => {
    const vehicle = createVehicle3d("compact", 0, cars);
    const body = bodyOf(vehicle.object).geometry;
    const flares = vehicle.object.getObjectByName("lamp-flares") as Mesh;
    const freeBody = vi.spyOn(body, "dispose");
    const freeFlares = vi.spyOn(flares.geometry, "dispose");
    vehicle.dispose();
    expect(freeFlares).toHaveBeenCalledTimes(1);
    expect(freeBody).not.toHaveBeenCalled();
    disposeGltfVehicleParts();
    expect(freeBody).toHaveBeenCalledTimes(1);
  });

  it("builds the bus, oldtimer and tank procedurally, and every kind before the Kit loads", () => {
    for (const kind of ["bus", "oldtimer", "tank"] as const)
      expect(buildVehicleModel(kind, 0, cars).shared).toBeUndefined();
    expect(buildVehicleModel("sedan", 0).shared).toBeUndefined();
    expect(buildVehicleModel("sedan", 0, cars).shared?.size).toBeGreaterThan(0);
  });
});

describe("createVehicleFactory", () => {
  /** A source that has loaded once `loaded` is set. */
  function source(loaded: { value: boolean }): CarAssetSource & {
    request: ReturnType<typeof vi.fn>;
  } {
    const cars = fixtureCarAssets();
    return {
      ready: () => (loaded.value ? cars : null),
      request: vi.fn(),
    };
  }

  afterEach(() => {
    disposeGltfVehicleParts();
  });

  it("asks for the Kit and builds procedurally until it lands, then from the Kit", () => {
    const loaded = { value: false };
    const cars = source(loaded);
    const factory = createVehicleFactory(cars);
    expect(factory.vehicleVariant?.("sedan", 2)).toBe("sedan:2");
    expect(cars.request).toHaveBeenCalled();
    expect(factory.vehicle("sedan", 2).object.name).toBe("vehicle-sedan");
    loaded.value = true;
    expect(factory.vehicleVariant?.("sedan", 2)).toBe("gltf:sedan:2");
    expect(factory.vehicleVariant?.("bus", 2)).toBe("bus:2");
    const kit = factory.vehicle("sedan", 2);
    expect(kit.object.getObjectByName("body")).toBeInstanceOf(Mesh);
  });
});
