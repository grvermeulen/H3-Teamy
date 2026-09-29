import { Group, Vector3, type Mesh, type Object3D } from "three";
import { afterEach, describe, expect, it } from "vitest";
import type { VehicleKind, WeaponKind } from "../sim/types";
import { widthOf } from "../sim/vehicle";
import { COCKPITS } from "./cockpitSpecs";
import { headingToRotationY } from "./coords";
import {
  createDriveBy3d,
  disposeDriveByAssets,
  standAtCar,
  type DriveByInput,
} from "./driveBy3d";
import { driveByPose, type WindowSide } from "./driveByPose";

const SLEEVE = 0x3a7bd5;

function input(overrides: Partial<DriveByInput> = {}): DriveByInput {
  return {
    kind: "sedan",
    side: "left",
    heading: 0,
    aim: -Math.PI / 2,
    weapon: "pistol",
    recoil: 0,
    ...overrides,
  };
}

function named(root: Object3D, name: string): Object3D {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`no ${name}`);
  return found;
}

function muzzleOf(
  kind: VehicleKind,
  side: WindowSide,
  aim: number,
  weapon: WeaponKind = "pistol",
): Vector3 {
  const arm = createDriveBy3d(SLEEVE);
  arm.update(input({ kind, side, aim, weapon }));
  const muzzle = new Vector3();
  expect(arm.muzzleWorld(muzzle)).toBe(true);
  return muzzle;
}

/** How far ahead of the car's centre the windscreen is at `height`, car space. */
function windscreenAt(kind: VehicleKind, height: number): number {
  const { eyeForwardM, glass } = COCKPITS[kind];
  const rise = (height - glass.baseM) / (glass.headerM - glass.baseM);
  return eyeForwardM + glass.aheadM - glass.rakeM * rise;
}

afterEach(() => {
  disposeDriveByAssets();
});

describe("createDriveBy3d", () => {
  it("holds the gun out of the driver's window when aiming left, and the passenger's aiming right", () => {
    for (const kind of ["compact", "sedan", "van", "oldtimer"] as const) {
      const half = widthOf(kind) / 2;
      expect(muzzleOf(kind, "left", -Math.PI / 2).z, kind).toBeLessThan(-half);
      expect(muzzleOf(kind, "right", Math.PI / 2).z, kind).toBeGreaterThan(
        half,
      );
    }
  });

  it("keeps the muzzle outside the car's footprint for every gun and window", () => {
    const guns: WeaponKind[] = ["pistol", "uzi", "shotgun", "rifle", "rocket"];
    for (const weapon of guns) {
      const left = muzzleOf("sedan", "left", -2.4, weapon);
      const right = muzzleOf("sedan", "right", 1.1, weapon);
      expect(Math.abs(left.z), weapon).toBeGreaterThan(widthOf("sedan") / 2);
      expect(Math.abs(right.z), weapon).toBeGreaterThan(widthOf("sedan") / 2);
    }
  });

  it("reaches over the dash with the muzzle through the windscreen", () => {
    for (const kind of ["sedan", "sport", "van", "pickup"] as const) {
      const muzzle = muzzleOf(kind, "front", 0.2);
      expect(muzzle.x, kind).toBeGreaterThan(windscreenAt(kind, muzzle.y));
      expect(muzzle.y, kind).toBeGreaterThan(COCKPITS[kind].bonnet.heightM);
    }
  });

  it("points the barrel along the aim, level", () => {
    const arm = createDriveBy3d(SLEEVE);
    arm.update(input({ side: "left", aim: -2.2 }));
    arm.object.updateMatrixWorld(true);
    const barrel = new Vector3(1, 0, 0).transformDirection(
      named(arm.object, "weapon:pistol").matrixWorld,
    );
    expect(barrel.x).toBeCloseTo(Math.cos(-2.2), 5);
    expect(barrel.y).toBeCloseTo(0, 5);
    expect(barrel.z).toBeCloseTo(Math.sin(-2.2), 5);
  });

  it("follows the car when stood where it is, turned to its heading", () => {
    const arm = createDriveBy3d(SLEEVE);
    const parent = new Group();
    parent.add(arm.object);
    standAtCar(arm.object, 12, -4, 0.8);
    expect(arm.object.position.toArray()).toEqual([12, 0, -4]);
    expect(arm.object.rotation.y).toBe(headingToRotationY(0.8));
    arm.update(input({ heading: 0.8, aim: 0.8 + Math.PI / 2, side: "right" }));
    arm.object.updateMatrixWorld(true);
    const barrel = new Vector3(1, 0, 0).transformDirection(
      named(arm.object, "weapon:pistol").matrixWorld,
    );
    expect(barrel.x).toBeCloseTo(Math.cos(0.8 + Math.PI / 2), 5);
    expect(barrel.z).toBeCloseTo(Math.sin(0.8 + Math.PI / 2), 5);
  });

  it("kicks the muzzle up on a shot", () => {
    const arm = createDriveBy3d(SLEEVE);
    const muzzle = new Vector3();
    arm.update(input());
    arm.muzzleWorld(muzzle);
    const rest = muzzle.y;
    arm.update(input({ recoil: 1 }));
    arm.muzzleWorld(muzzle);
    expect(muzzle.y).toBeGreaterThan(rest);
  });

  it("runs the sleeve from the driver's shoulder to the elbow on the sill", () => {
    const arm = createDriveBy3d(SLEEVE);
    arm.update(input({ side: "right", aim: 1.4 }));
    const pose = driveByPose("sedan", "right", 0, 1.4);
    const upper = named(arm.object, "drive-by-sleeve");
    upper.updateWorldMatrix(true, false);
    const start = upper.localToWorld(new Vector3(0, 0, 0));
    const end = upper.localToWorld(new Vector3(0, 0, 1));
    expect(start.toArray().map((value) => +value.toFixed(5))).toEqual(
      pose.shoulder.map((value) => +value.toFixed(5)),
    );
    expect(end.distanceTo(new Vector3(...pose.elbow))).toBeLessThan(1e-5);
  });

  it("swaps the gun when the weapon changes, and has no muzzle without one", () => {
    const arm = createDriveBy3d(SLEEVE);
    arm.update(input({ weapon: "uzi" }));
    expect(arm.object.getObjectByName("weapon:uzi")).toBeDefined();
    arm.update(input({ weapon: "shotgun" }));
    expect(arm.object.getObjectByName("weapon:uzi")).toBeUndefined();
    expect(arm.object.getObjectByName("weapon:shotgun")).toBeDefined();
    arm.update(input({ weapon: "fist" }));
    expect(arm.muzzleWorld(new Vector3())).toBe(false);
  });

  it("shares the forearm and a sleeve colour's geometry, freeing them with the shared assets", () => {
    const first = createDriveBy3d(SLEEVE);
    const second = createDriveBy3d(SLEEVE);
    const other = createDriveBy3d(0xd05050);
    const sleeve = (arm: typeof first): Mesh =>
      named(arm.object, "drive-by-sleeve") as Mesh;
    const forearm = (arm: typeof first): Mesh =>
      named(arm.object, "drive-by-forearm") as Mesh;
    expect(sleeve(first).geometry).toBe(sleeve(second).geometry);
    expect(sleeve(first).geometry).not.toBe(sleeve(other).geometry);
    expect(forearm(first).geometry).toBe(forearm(other).geometry);
    disposeDriveByAssets();
    expect(sleeve(createDriveBy3d(SLEEVE)).geometry).not.toBe(
      sleeve(first).geometry,
    );
  });

  it("detaches itself on dispose", () => {
    const arm = createDriveBy3d(SLEEVE);
    const parent = new Group();
    parent.add(arm.object);
    arm.dispose();
    expect(arm.object.parent).toBeNull();
  });
});
