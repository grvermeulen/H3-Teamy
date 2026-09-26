import { describe, expect, it } from "vitest";
import {
  Box3,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { lengthOf, VEHICLE_KINDS, widthOf } from "../sim/vehicle";
import { CAR_BODY_COLOURS } from "../render/palette";
import { buildVehicleModel, vehicleHeight } from "./vehicleModels";

/** Allowed relative difference between the model and the simulation's footprint. */
const FOOTPRINT_TOLERANCE = 0.05;
/** Triangle budget of one vehicle. */
const MAX_TRIANGLES = 2000;
/** Mesh budget of one vehicle: a body, four wheels and a few moving parts. */
const MAX_MESHES = 8;

function meshesOf(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh) meshes.push(node);
  });
  return meshes;
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function bodyOf(root: Object3D): Mesh {
  const body = root.getObjectByName("body");
  if (!(body instanceof Mesh)) throw new Error("model has no body mesh");
  return body;
}

function paintOf(root: Object3D): MeshPhongMaterial {
  const paint = materialsOf(bodyOf(root))[0];
  if (!(paint instanceof MeshPhongMaterial)) throw new Error("no paint");
  return paint;
}

function sizeOf(root: Object3D): { box: Box3; size: Vector3 } {
  const box = new Box3().setFromObject(root);
  return { box, size: box.getSize(new Vector3()) };
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / expected;
}

describe("buildVehicleModel", () => {
  it.each(VEHICLE_KINDS)(
    "builds a %s at the simulation's footprint",
    (kind) => {
      const { size } = sizeOf(buildVehicleModel(kind, 0).root);

      expect(relativeError(size.x, lengthOf(kind))).toBeLessThanOrEqual(
        FOOTPRINT_TOLERANCE,
      );
      expect(relativeError(size.z, widthOf(kind))).toBeLessThanOrEqual(
        FOOTPRINT_TOLERANCE,
      );
    },
  );

  it.each(VEHICLE_KINDS)(
    "stands a %s on the ground, centred, as tall as vehicleHeight",
    (kind) => {
      const { box, size } = sizeOf(buildVehicleModel(kind, 0).root);
      const centre = box.getCenter(new Vector3());

      expect(box.min.y).toBeCloseTo(0, 2);
      expect(relativeError(size.y, vehicleHeight(kind))).toBeLessThanOrEqual(
        FOOTPRINT_TOLERANCE,
      );
      expect(Math.abs(centre.x)).toBeLessThan(lengthOf(kind) * 0.05);
      expect(Math.abs(centre.z)).toBeLessThan(widthOf(kind) * 0.05);
    },
  );

  it.each(VEHICLE_KINDS)("keeps a %s within budget, without NaN", (kind) => {
    const meshes = meshesOf(buildVehicleModel(kind, 0).root);
    const triangles = meshes.reduce(
      (sum, mesh) => sum + (mesh.geometry.index?.count ?? 0) / 3,
      0,
    );
    const positions = meshes.flatMap((mesh) =>
      Array.from(mesh.geometry.getAttribute("position").array),
    );

    expect(meshes.length).toBeLessThanOrEqual(MAX_MESHES);
    expect(triangles).toBeLessThanOrEqual(MAX_TRIANGLES);
    expect(positions.some(Number.isNaN)).toBe(false);
  });

  it.each(VEHICLE_KINDS)(
    "puts four wheels on the ground under a %s",
    (kind) => {
      const { wheels } = buildVehicleModel(kind, 0);

      expect(wheels).toHaveLength(4);
      for (const wheel of wheels)
        expect(wheel.pivot.position.y).toBeCloseTo(wheel.radius, 5);
    },
  );

  it("steers the front pair and gives the tractor big rear wheels", () => {
    const sedan = buildVehicleModel("sedan", 0).wheels;
    const tractor = buildVehicleModel("tractor", 0).wheels;
    const tank = buildVehicleModel("tank", 0).wheels;
    const front = (wheels: typeof sedan) =>
      wheels.filter((wheel) => wheel.pivot.position.x > 0);

    expect(front(sedan).every((wheel) => wheel.steers)).toBe(true);
    expect(sedan.filter((wheel) => wheel.steers)).toHaveLength(2);
    const rearRadius = tractor.find((wheel) => !wheel.steers)?.radius ?? 0;
    const frontRadius = tractor.find((wheel) => wheel.steers)?.radius ?? 0;
    expect(rearRadius).toBeGreaterThan(frontRadius * 1.5);
    expect(tank.some((wheel) => wheel.steers)).toBe(false);
  });

  it("paints tinted kinds in the palette colour, one shared material per colour", () => {
    const sedan = paintOf(buildVehicleModel("sedan", 2).root);
    const van = paintOf(buildVehicleModel("van", 2).root);
    const other = paintOf(buildVehicleModel("sedan", 3).root);

    expect(`#${sedan.color.getHexString()}`).toBe(CAR_BODY_COLOURS[2]);
    expect(van).toBe(sedan);
    expect(other).not.toBe(sedan);
  });

  it("keeps the fixed liveries whatever the colour index", () => {
    for (const kind of ["police", "bus", "tractor", "tank"] as const)
      expect(paintOf(buildVehicleModel(kind, 1).root)).toBe(
        paintOf(buildVehicleModel(kind, 6).root),
      );
    const police = paintOf(buildVehicleModel("police", 0).root).color;
    const tractor = paintOf(buildVehicleModel("tractor", 0).root).color;
    const tank = paintOf(buildVehicleModel("tank", 0).root).color;

    expect(Math.min(police.r, police.g, police.b)).toBeGreaterThan(0.8);
    expect(tractor.g).toBeGreaterThan(Math.max(tractor.r, tractor.b));
    expect(tank.g).toBeGreaterThan(tank.b);
    expect(tank.r).toBeGreaterThan(tank.b);
  });

  it.each(VEHICLE_KINDS)("lights a %s with head and tail lamps", (kind) => {
    const emissive = materialsOf(bodyOf(buildVehicleModel(kind, 0).root))
      .filter((material) => material instanceof MeshLambertMaterial)
      .map((material) => material.emissive.getHex());

    expect(emissive).toContain(0xfff3c4);
    expect(emissive).toContain(0xff2a2a);
  });

  it("gives the police a light bar, the tank a turret and nobody else either", () => {
    for (const kind of VEHICLE_KINDS) {
      const model = buildVehicleModel(kind, 0);
      expect(model.lightBar !== null).toBe(kind === "police");
      expect(model.turret !== null).toBe(kind === "tank");
    }
  });

  it("points the tank's barrel forward, reaching the nose", () => {
    const { turret } = buildVehicleModel("tank", 0);
    if (!turret) throw new Error("tank without turret");
    const box = new Box3().setFromObject(turret);

    expect(box.max.x).toBeCloseTo(lengthOf("tank") / 2, 1);
  });
});
