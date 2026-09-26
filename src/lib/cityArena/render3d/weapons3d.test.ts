import { describe, expect, it } from "vitest";
import { Box3, Mesh, Vector3 } from "three";
import { createWeaponModel, isTwoHanded, type ModelWeapon } from "./weapons3d";

function sizeOf(kind: ModelWeapon): Vector3 {
  return new Box3()
    .setFromObject(createWeaponModel(kind))
    .getSize(new Vector3());
}

const CARRIED: ModelWeapon[] = [
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

  it("marks the long guns and the launcher as two-handed", () => {
    expect(
      ["shotgun", "rifle", "rocket"].every((kind) =>
        isTwoHanded(kind as ModelWeapon),
      ),
    ).toBe(true);
    expect(isTwoHanded("pistol")).toBe(false);
    expect(isTwoHanded("uzi")).toBe(false);
    expect(isTwoHanded("bat")).toBe(false);
  });
});
