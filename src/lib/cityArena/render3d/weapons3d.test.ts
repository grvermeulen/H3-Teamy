import { describe, expect, it } from "vitest";
import { Box3, Mesh, Vector3 } from "three";
import type { WeaponKind } from "../sim/types";
import { createWeaponModel, isTwoHanded, muzzleTipOf } from "./weapons3d";

function sizeOf(kind: WeaponKind): Vector3 {
  return new Box3()
    .setFromObject(createWeaponModel(kind))
    .getSize(new Vector3());
}

const CARRIED: WeaponKind[] = [
  "pistol",
  "uzi",
  "shotgun",
  "rifle",
  "bat",
  "rocket",
];

describe("createWeaponModel", () => {
  it("makes the rocket launcher a tube longer than 0.9 m", () => {
    expect(sizeOf("rocket").x).toBeGreaterThan(0.9);
  });

  it("gives a fist or the tank's cannon nothing to hold", () => {
    expect(createWeaponModel("fist").children).toHaveLength(0);
    expect(createWeaponModel("cannon").children).toHaveLength(0);
  });

  it.each(CARRIED)("points the %s forward along +X from the grip", (kind) => {
    const box = new Box3().setFromObject(createWeaponModel(kind));
    expect(box.max.x).toBeGreaterThan(Math.abs(box.min.x));
    expect(box.getSize(new Vector3()).x).toBeGreaterThan(
      box.getSize(new Vector3()).y,
    );
  });

  it("orders the guns by length: pistol < uzi < shotgun", () => {
    expect(sizeOf("pistol").x).toBeLessThan(sizeOf("uzi").x);
    expect(sizeOf("uzi").x).toBeLessThan(sizeOf("shotgun").x);
  });

  it("shares one cached geometry between models of a kind", () => {
    const first = createWeaponModel("rifle").children[0] as Mesh;
    const second = createWeaponModel("rifle").children[0] as Mesh;
    expect(first).not.toBe(second);
    expect(first.geometry).toBe(second.geometry);
    expect(first.material).toBe(second.material);
  });

  it("puts each gun's muzzle at the front end of its barrel", () => {
    const tips: [WeaponKind, number[]][] = [
      ["pistol", [0.158, 0.06, 0]],
      ["uzi", [0.245, 0.065, 0]],
      ["shotgun", [0.66, 0.078, 0]],
      ["rifle", [0.56, 0.07, 0]],
    ];
    for (const [kind, expected] of tips)
      muzzleTipOf(kind)?.forEach((value, axis) =>
        expect(value).toBeCloseTo(expected[axis], 9),
      );
    for (const kind of [
      "pistol",
      "uzi",
      "shotgun",
      "rifle",
      "rocket",
    ] as const) {
      const box = new Box3().setFromObject(createWeaponModel(kind));
      expect(muzzleTipOf(kind)?.[0]).toBeCloseTo(box.max.x, 3);
    }
  });

  it("gives fists, the bat and the tank's cannon no muzzle to flash", () => {
    expect(muzzleTipOf("fist")).toBeNull();
    expect(muzzleTipOf("bat")).toBeNull();
    expect(muzzleTipOf("cannon")).toBeNull();
  });

  it("marks the long guns and the launcher as two-handed", () => {
    expect(
      (["shotgun", "rifle", "rocket"] as const).every((kind) =>
        isTwoHanded(kind),
      ),
    ).toBe(true);
    expect(isTwoHanded("pistol")).toBe(false);
    expect(isTwoHanded("uzi")).toBe(false);
    expect(isTwoHanded("bat")).toBe(false);
  });
});
