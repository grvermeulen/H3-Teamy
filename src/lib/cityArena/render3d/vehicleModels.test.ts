import { describe, expect, it } from "vitest";
import {
  Box3,
  Color,
  Mesh,
  Points,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { lengthOf, VEHICLE_KINDS, widthOf } from "../sim/vehicle";
import { CAR_BODY_COLOURS } from "../render/palette";
import { buildVehicleModel, vehicleHeight } from "./vehicleModels";
import { TAIL_RUNNING } from "./vehicleLamps";
import { HEADLIGHT } from "./vehicleShapes";
import { PLATE_LOOKS } from "./vehicleTrim";
import type { VehicleKind } from "../sim/types";

/** Allowed relative difference between the model and the simulation's footprint. */
const FOOTPRINT_TOLERANCE = 0.05;
/** Triangle budget of one vehicle. */
const MAX_TRIANGLES = 2000;
/** Mesh budget of one vehicle: a body, four wheels and a few moving parts. */
const MAX_MESHES = 8;
/** Each kind's draw calls before the lamps' flares and the trim. */
const DRAW_CALLS_BEFORE: Record<VehicleKind, number> = {
  compact: 8,
  sedan: 8,
  sport: 8,
  police: 10,
  van: 8,
  pickup: 8,
  bus: 9,
  oldtimer: 8,
  tractor: 8,
  tank: 10,
};
/** How many more draw calls a vehicle may take now. */
const EXTRA_DRAW_CALLS = 2;
/** The kinds that carry plates at both ends. */
const PASSENGER_KINDS: readonly VehicleKind[] = [
  "compact",
  "sedan",
  "sport",
  "police",
  "van",
  "pickup",
  "oldtimer",
  "bus",
];

/** One draw per material group of a multi-material mesh, one per other mesh or point cloud. */
function drawCallsOf(root: Object3D): number {
  let calls = 0;
  root.traverse((node) => {
    if (node instanceof Mesh)
      calls += Array.isArray(node.material) ? node.geometry.groups.length : 1;
    else if (node instanceof Points) calls += 1;
  });
  return calls;
}

/** Whether the body has vertices in the plate's colour at its front and at its back end. */
function plateEnds(
  body: Mesh,
  plate: Color,
): { front: boolean; rear: boolean } {
  const colours = body.geometry.getAttribute("color");
  const positions = body.geometry.getAttribute("position");
  body.geometry.computeBoundingBox();
  const { min, max } = body.geometry.boundingBox!;
  const reach = (max.x - min.x) * 0.45;
  const ends = { front: false, rear: false };
  for (let index = 0; index < colours.count; index++) {
    const matches =
      Math.abs(colours.getX(index) - plate.r) < 1e-3 &&
      Math.abs(colours.getY(index) - plate.g) < 1e-3 &&
      Math.abs(colours.getZ(index) - plate.b) < 1e-3;
    if (!matches) continue;
    if (positions.getX(index) > reach) ends.front = true;
    if (positions.getX(index) < -reach) ends.rear = true;
  }
  return ends;
}

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

  it.each(VEHICLE_KINDS)(
    "lights a %s with head lamps and running tail lamps, each with a flare",
    (kind) => {
      const { root, lamps } = buildVehicleModel(kind, 0);
      const emissive = materialsOf(bodyOf(root))
        .filter((material) => material instanceof MeshLambertMaterial)
        .map((material) => material.emissive.getHex());

      expect(emissive).toContain(HEADLIGHT);
      expect(emissive).toContain(TAIL_RUNNING);
      expect(lamps.tailSlot).toBeGreaterThanOrEqual(0);
      expect(lamps.flares?.parent).toBe(root);
      const heads = lamps.lamps.filter((lamp) => !lamp.tail);
      const tails = lamps.lamps.filter((lamp) => lamp.tail);
      expect(heads.length).toBeGreaterThanOrEqual(2);
      expect(tails.length).toBeGreaterThanOrEqual(2);
      for (const lamp of heads) expect(lamp.facing).toBe(1);
      for (const lamp of tails) expect(lamp.facing).toBe(-1);
      expect(lamps.flares?.geometry.getAttribute("position").count).toBe(
        lamps.lamps.length,
      );
    },
  );

  it.each(VEHICLE_KINDS)(
    "draws a %s in at most two more calls than before the lamps and trim",
    (kind) => {
      expect(drawCallsOf(buildVehicleModel(kind, 0).root)).toBeLessThanOrEqual(
        DRAW_CALLS_BEFORE[kind] + EXTRA_DRAW_CALLS,
      );
    },
  );

  it("wears plates front and back on every passenger kind, classic blue on the oldtimer", () => {
    for (const kind of PASSENGER_KINDS) {
      const body = bodyOf(buildVehicleModel(kind, 0).root);
      const look =
        kind === "oldtimer" ? PLATE_LOOKS.classic : PLATE_LOOKS.modern;

      expect(plateEnds(body, new Color(look.plate)), kind).toEqual({
        front: true,
        rear: true,
      });
    }
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
