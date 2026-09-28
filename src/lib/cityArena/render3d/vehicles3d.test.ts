import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Mesh,
  MeshLambertMaterial,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { POLICE_LIGHT_BLUE, POLICE_LIGHT_RED } from "../render/palette";
import { headingToRotationY } from "./coords";
import { createVehicle3d, type Vehicle3dInput } from "./vehicles3d";

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

/** The charred look of a wreck (spec: 0x1a1512). */
const CHARRED = 0x1a1512;

function hex(css: string): number {
  return Number.parseInt(css.slice(1), 16);
}

function wheelsOf(root: Object3D): Mesh[] {
  return root.getObjectsByProperty("name", "wheel") as Mesh[];
}

function radiusOf(wheel: Mesh): number {
  wheel.geometry.computeBoundingBox();
  const size = wheel.geometry.boundingBox?.getSize(new Vector3());
  return (size?.y ?? 0) / 2;
}

function meshesOf(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh) meshes.push(node);
  });
  return meshes;
}

function materialsOf(root: Object3D): Material[] {
  return meshesOf(root).flatMap((mesh) =>
    Array.isArray(mesh.material) ? mesh.material : [mesh.material],
  );
}

function lensGlow(root: Object3D, name: string): number {
  const lens = root.getObjectByName(name);
  if (!(lens instanceof Mesh)) throw new Error(`no ${name}`);
  const material = lens.material as MeshLambertMaterial;
  return material.emissive.getHex();
}

describe("createVehicle3d", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rolls the wheels forward by speed over radius", () => {
    const car = createVehicle3d("sedan", 0);

    car.update({ ...PARKED, speed: 3, dt: 0.05 });

    const wheels = wheelsOf(car.object);
    expect(wheels).toHaveLength(4);
    for (const wheel of wheels)
      expect(wheel.rotation.z).toBeCloseTo(-(3 / radiusOf(wheel)) * 0.05, 5);
  });

  it("turns big wheels slower than small ones and backwards in reverse", () => {
    const tractor = createVehicle3d("tractor", 0);

    tractor.update({ ...PARKED, speed: -2, dt: 0.1 });

    const bySize = wheelsOf(tractor.object).sort(
      (a, b) => radiusOf(b) - radiusOf(a),
    );
    const biggest = bySize[0];
    const smallest = bySize[bySize.length - 1];
    expect(biggest.rotation.z).toBeGreaterThan(0);
    expect(smallest.rotation.z).toBeGreaterThan(biggest.rotation.z);
  });

  it("steers the front pair by steer × 0.5 rad and keeps the rear straight", () => {
    const car = createVehicle3d("sedan", 0);

    car.update({ ...PARKED, steer: 0.6 });

    const pivots = wheelsOf(car.object).flatMap((wheel) =>
      wheel.parent ? [wheel.parent] : [],
    );
    const front = pivots.filter((pivot) => pivot.position.x > 0);
    const rear = pivots.filter((pivot) => pivot.position.x < 0);
    for (const pivot of front)
      expect(pivot.rotation.y).toBeCloseTo(headingToRotationY(0.3), 5);
    for (const pivot of rear) expect(pivot.rotation.y).toBe(0);
  });

  it("chars every material when wrecked and restores the paint on repair", () => {
    const car = createVehicle3d("police", 4);
    const intact = materialsOf(car.object);

    car.update({ ...PARKED, wrecked: true, siren: true });

    const charred = new Set(materialsOf(car.object));
    expect(charred.size).toBe(1);
    const [only] = charred as Set<MeshLambertMaterial>;
    expect(only.color.getHex()).toBe(CHARRED);
    expect(only.emissive.getHex()).toBe(0);
    const otherWreck = createVehicle3d("tank", 0);
    otherWreck.update({ ...PARKED, wrecked: true });
    expect(new Set(materialsOf(otherWreck.object))).toEqual(charred);

    car.update(PARKED);
    expect(materialsOf(car.object)).toEqual(intact);
  });

  it("flashes the police bar blue and red in turn at 4 Hz with the siren on", () => {
    const car = createVehicle3d("police", 0);
    const glowAt = (tick: number) => {
      car.update({ ...PARKED, siren: true, tick });
      return [
        lensGlow(car.object, "light-bar-left"),
        lensGlow(car.object, "light-bar-right"),
      ];
    };

    expect(glowAt(0)).toEqual([hex(POLICE_LIGHT_BLUE), 0]);
    expect(glowAt(4)).toEqual([0, hex(POLICE_LIGHT_RED)]);
    expect(glowAt(8)).toEqual([hex(POLICE_LIGHT_BLUE), 0]);
  });

  it("keeps the bar dark with the siren off", () => {
    const car = createVehicle3d("police", 0);

    for (const tick of [0, 4, 8]) {
      car.update({ ...PARKED, tick });
      expect(lensGlow(car.object, "light-bar-left")).toBe(0);
      expect(lensGlow(car.object, "light-bar-right")).toBe(0);
    }
  });

  it("turns the turret to the aim relative to the hull", () => {
    const tank = createVehicle3d("tank", 0);
    const turret = tank.object.getObjectByName("turret");
    if (!turret) throw new Error("tank without turret");

    tank.object.rotation.y = headingToRotationY(0.4);
    tank.update({ ...PARKED, turretYaw: 1.2 });
    expect(turret.rotation.y).toBeCloseTo(headingToRotationY(0.8), 5);

    tank.update(PARKED);
    expect(turret.rotation.y).toBe(0);
  });

  it("frees its geometry on dispose but keeps the shared materials", () => {
    const car = createVehicle3d("sedan", 1);
    const [body] = meshesOf(car.object);
    const geometryDispose = vi.spyOn(body.geometry, "dispose");
    const materialDisposes = [...new Set(materialsOf(car.object))].map(
      (material) => vi.spyOn(material, "dispose"),
    );

    car.dispose();

    expect(geometryDispose).toHaveBeenCalledOnce();
    for (const spy of materialDisposes) expect(spy).not.toHaveBeenCalled();
  });
});
