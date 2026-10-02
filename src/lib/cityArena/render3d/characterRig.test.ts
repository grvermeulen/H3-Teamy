import { describe, expect, it } from "vitest";
import { Box3, Color, Vector3, type BufferAttribute } from "three";
import { LOOKS, vestColour, type CharacterLook } from "./characterLooks";
import {
  BONE_PARENTS,
  BONES,
  buildCharacterMesh,
  characterMaterials,
} from "./characterRig";

const ALL_LOOKS = Object.keys(LOOKS) as CharacterLook[];

function boundsOf(look: CharacterLook, vestHue?: number): Box3 {
  const mesh = buildCharacterMesh(LOOKS[look], vestHue);
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox as Box3;
}

function hasColour(attribute: BufferAttribute, hex: number): boolean {
  const target = new Color(hex);
  for (let index = 0; index < attribute.count; index += 1) {
    const near =
      Math.abs(attribute.getX(index) - target.r) < 1e-4 &&
      Math.abs(attribute.getY(index) - target.g) < 1e-4 &&
      Math.abs(attribute.getZ(index) - target.b) < 1e-4;
    if (near) return true;
  }
  return false;
}

describe("BONES", () => {
  it("names 17 bones, pelvis first, each parented to an earlier bone", () => {
    expect(BONES).toHaveLength(17);
    expect(BONES[0]).toBe("pelvis");
    BONES.forEach((bone, index) => {
      const parent = BONE_PARENTS[bone];
      if (index === 0) expect(parent).toBeNull();
      else expect(BONES.indexOf(parent as never)).toBeLessThan(index);
    });
  });
});

describe("buildCharacterMesh", () => {
  it.each(ALL_LOOKS)("binds every vertex of %s rigidly to one bone", (look) => {
    const mesh = buildCharacterMesh(LOOKS[look]);
    const skinIndex = mesh.geometry.getAttribute("skinIndex");
    const skinWeight = mesh.geometry.getAttribute("skinWeight");
    expect(skinIndex.array).toBeInstanceOf(Uint16Array);
    expect(skinWeight.array).toBeInstanceOf(Float32Array);
    expect(skinIndex.count).toBe(mesh.geometry.getAttribute("position").count);
    for (let index = 0; index < skinIndex.count; index += 1) {
      expect(skinIndex.getX(index)).toBeLessThan(BONES.length);
      expect([
        skinWeight.getX(index),
        skinWeight.getY(index),
        skinWeight.getZ(index),
        skinWeight.getW(index),
      ]).toEqual([1, 0, 0, 0]);
    }
  });

  it.each(ALL_LOOKS)("stands %s on the ground at the look's height", (look) => {
    const bounds = boundsOf(look);
    expect(bounds.min.y).toBeCloseTo(0, 2);
    expect(Math.abs(bounds.max.y - LOOKS[look].height)).toBeLessThanOrEqual(
      0.1,
    );
  });

  it("gives each build its shoulder width", () => {
    const width = (look: CharacterLook): number =>
      boundsOf(look).getSize(new Vector3()).z;
    expect(width("player")).toBeCloseTo(0.56, 1);
    expect(width("ped5")).toBeCloseTo(0.44, 1);
    expect(width("ped6")).toBeCloseTo(0.38, 1);
  });

  it("faces +X: toes reach further forward than the back reaches behind", () => {
    const bounds = boundsOf("ped5");
    expect(bounds.max.x).toBeGreaterThan(Math.abs(bounds.min.x));
  });

  it("makes a 17-bone skeleton with bones at their joints", () => {
    const mesh = buildCharacterMesh(LOOKS.ped1);
    expect(mesh.skeleton.bones.map((bone) => bone.name)).toEqual([...BONES]);
    mesh.updateMatrixWorld(true);
    const pelvis = mesh.skeleton.bones[0].getWorldPosition(new Vector3());
    const head = mesh.skeleton
      .getBoneByName("head")
      ?.getWorldPosition(new Vector3());
    expect(pelvis.y).toBeCloseTo(0.95);
    expect(head?.y).toBeGreaterThan(1.5);
  });

  it("shares geometry and material per look but builds a fresh skeleton", () => {
    const first = buildCharacterMesh(LOOKS.cop);
    const second = buildCharacterMesh(LOOKS.cop);
    expect(first.geometry).toBe(second.geometry);
    expect(first.material).toBe(second.material);
    expect(first.skeleton).not.toBe(second.skeleton);
    expect(first.skeleton.bones[0]).not.toBe(second.skeleton.bones[0]);
    expect(buildCharacterMesh(LOOKS.ped1).material).toBe(first.material);
  });

  it("uses the one vertex-coloured Lambert material for the body", () => {
    const { body, glow } = characterMaterials();
    expect(body.vertexColors).toBe(true);
    expect(glow.vertexColors).toBe(true);
    const mesh = buildCharacterMesh(LOOKS.ped2);
    expect(mesh.material).toEqual([body, glow]);
    expect(
      mesh.geometry.groups.every((group) => group.materialIndex === 0),
    ).toBe(true);
  });

  it("lights only the player's lenses with the glow material", () => {
    const mesh = buildCharacterMesh(LOOKS.player);
    expect(mesh.geometry.groups.map((group) => group.materialIndex)).toEqual([
      0, 1,
    ]);
  });

  it("paints the look's colours: mint shorts, neon bands", () => {
    const colours = (look: CharacterLook): BufferAttribute =>
      buildCharacterMesh(LOOKS[look]).geometry.getAttribute(
        "color",
      ) as BufferAttribute;
    expect(hasColour(colours("player"), 0x9fe0c4)).toBe(true);
    expect(hasColour(colours("cop"), 0xd7ff1f)).toBe(true);
  });

  it("colours other players' vests by hue, one cached geometry per hue", () => {
    const red = buildCharacterMesh(LOOKS.otherPlayer, 0);
    const blue = buildCharacterMesh(LOOKS.otherPlayer, 0.6);
    expect(red.geometry).not.toBe(blue.geometry);
    expect(buildCharacterMesh(LOOKS.otherPlayer, 0).geometry).toBe(
      red.geometry,
    );
    const colour = red.geometry.getAttribute("color") as BufferAttribute;
    expect(hasColour(colour, vestColour(0))).toBe(true);
    expect(buildCharacterMesh(LOOKS.ped3, 0.2).geometry).toBe(
      buildCharacterMesh(LOOKS.ped3, 0.7).geometry,
    );
  });

  it("keeps culling generous enough for any pose", () => {
    const mesh = buildCharacterMesh(LOOKS.ped4);
    expect(mesh.boundingSphere?.radius).toBeGreaterThanOrEqual(1.2);
  });
});
