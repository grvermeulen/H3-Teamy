import { Mesh, type BufferGeometry, type Material } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCharacterMesh, characterMaterials } from "./characterRig";
import { LOOKS } from "./characterLooks";
import { createCockpit3d } from "./cockpit3d";
import { createPickup3d } from "./pickups3d";
import { disposeSharedAssets } from "./sharedAssets";
import {
  detailMaterial,
  glowMaterial,
  matteMaterial,
  paintMaterial,
} from "./vehicleParts";
import { createWeaponModel } from "./weapons3d";

/** Every mesh's geometry and material under a pickup's object. */
function pickupParts(): (BufferGeometry | Material)[] {
  const parts: (BufferGeometry | Material)[] = [];
  createPickup3d("health").object.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    parts.push(node.geometry as BufferGeometry, node.material as Material);
  });
  return parts;
}

/** The shared weapon geometry of a pistol in hand. */
function pistolGeometry(): BufferGeometry {
  return (createWeaponModel("pistol").children[0] as Mesh).geometry;
}

/** A police cockpit's shared geometry and materials: interior, wheel, glass and siren glow. */
function cockpitParts(): (BufferGeometry | Material)[] {
  const cockpit = createCockpit3d();
  cockpit.update({
    kind: "police",
    colour: 0,
    steer: 0,
    speedMps: 0,
    siren: true,
    tick: 0,
    dt: 0,
  });
  const parts: (BufferGeometry | Material)[] = [];
  for (const name of ["cockpit-shell", "cockpit-glass", "cockpit-siren-left"]) {
    const mesh = cockpit.object.getObjectByName(name) as Mesh;
    parts.push(mesh.geometry as BufferGeometry, mesh.material as Material);
  }
  return parts;
}

/** One of every shared asset, as the first view to use it builds it. */
function sharedAssets(): (BufferGeometry | Material)[] {
  const materials = characterMaterials();
  return [
    materials.body,
    materials.glow,
    buildCharacterMesh(LOOKS.otherPlayer, 0.3).geometry,
    paintMaterial(0xff0000),
    detailMaterial(),
    glowMaterial(0xffee00),
    matteMaterial(0x222222),
    ...pickupParts(),
    ...cockpitParts(),
    pistolGeometry(),
  ];
}

describe("disposeSharedAssets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("frees every cached geometry and material once", () => {
    const assets = sharedAssets();
    const freed = assets.map((asset) => vi.spyOn(asset, "dispose"));
    disposeSharedAssets();
    for (const free of freed) expect(free).toHaveBeenCalledTimes(1);
  });

  it("empties the caches, so the next view builds fresh ones and shares those again", () => {
    const before = sharedAssets();
    disposeSharedAssets();
    const after = sharedAssets();
    for (const [position, asset] of after.entries())
      expect(asset).not.toBe(before[position]);
    expect(characterMaterials()).toBe(characterMaterials());
    expect(paintMaterial(0xff0000)).toBe(after[3]);
    expect(pistolGeometry()).toBe(after.at(-1));
  });

  it("frees nothing twice when called again with the caches empty", () => {
    const body = characterMaterials().body;
    const free = vi.spyOn(body, "dispose");
    disposeSharedAssets();
    disposeSharedAssets();
    expect(free).toHaveBeenCalledTimes(1);
  });
});
