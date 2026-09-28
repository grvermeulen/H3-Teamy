import { AnimationMixer, Group, Vector3, type Object3D } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appearanceOf, type Appearance } from "./characterAppearance";
import type { PoseInput } from "./characterPose";
import { createGltfCharacter, isGltfCharacter } from "./gltfCharacter";
import {
  DEATH_END_X,
  ROLE_VALUE,
  fixtureCharacterAssets,
} from "./testing/gltfFixture";

const ASSETS = fixtureCharacterAssets();
/** A frame at 30 fps. */
const FRAME_S = 1 / 30;

/** A pose at rest with `changes`, stepping one frame. */
function pose(changes: Partial<PoseInput> = {}): PoseInput {
  return {
    speed: 0,
    phaseM: 0,
    aiming: false,
    weapon: null,
    dead: false,
    tick: 0,
    recoil: 0,
    dt: FRAME_S,
    ...changes,
  };
}

/** A pedestrian's appearance on the casual man, without accessories. */
function casual(): Appearance {
  return { ...appearanceOf("ped1", 1), model: "casual-man", extras: [] };
}

/** A bone of the character by name. */
function bone(object: Object3D, name: string): Object3D {
  const found = object.getObjectByName(name);
  if (!found) throw new Error(`no ${name}`);
  return found;
}

/** Updates a character for `seconds` with the same pose. */
function run(
  character: ReturnType<typeof createGltfCharacter>,
  input: PoseInput,
  seconds: number,
): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += FRAME_S)
    character.update(input);
}

describe("createGltfCharacter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("faces local +X like the procedural characters", () => {
    const character = createGltfCharacter(ASSETS, casual(), 1.8);
    const forward = new Vector3(0, 0, 1).applyQuaternion(
      character.object.children[0].quaternion,
    );
    expect(forward.x).toBeCloseTo(1);
    expect(forward.z).toBeCloseTo(0);
    expect(isGltfCharacter(character)).toBe(true);
  });

  it("stands at idle, then walks at walking speed", () => {
    const character = createGltfCharacter(ASSETS, casual(), 1.8);
    run(character, pose(), 0.5);
    expect(bone(character.object, "Hips").position.x).toBeCloseTo(
      ROLE_VALUE.idle,
      2,
    );
    run(character, pose({ speed: 1.5 }), 2);
    expect(bone(character.object, "Hips").position.x).toBeCloseTo(
      ROLE_VALUE.walk,
      2,
    );
  });

  it("raises the gun with the upper body while the legs keep walking", () => {
    const character = createGltfCharacter(ASSETS, casual(), 1.8);
    run(character, pose({ speed: 1.5, aiming: true, weapon: "pistol" }), 2);
    expect(bone(character.object, "Chest").position.x).toBeCloseTo(
      ROLE_VALUE.gunIdle,
      2,
    );
    expect(bone(character.object, "Hips").position.x).toBeCloseTo(
      ROLE_VALUE.walk,
      2,
    );
  });

  it("holds a pistol in the right hand and reports its muzzle", () => {
    const character = createGltfCharacter(ASSETS, casual(), 1.8);
    const scene = new Group().add(character.object);
    character.update(pose({ weapon: "pistol" }));
    const hand = bone(character.object, "WristR");
    expect(hand.children.map((child) => child.name)).toContain("weapon:pistol");
    const muzzle = new Vector3();
    expect(character.muzzleWorld(muzzle)).toBe(true);
    expect(muzzle.length()).toBeGreaterThan(0);
    character.update(pose({ weapon: "fist" }));
    expect(character.muzzleWorld(muzzle)).toBe(false);
    scene.clear();
  });

  it("falls with the death clip and stays down on its last frame", () => {
    const character = createGltfCharacter(ASSETS, casual(), 1.8);
    run(character, pose(), 0.2);
    run(character, pose({ dead: true }), 2);
    expect(bone(character.object, "Hips").position.x).toBeCloseTo(
      DEATH_END_X,
      1,
    );
    run(character, pose({ dead: true }), 1);
    expect(bone(character.object, "Hips").position.x).toBeCloseTo(
      DEATH_END_X,
      1,
    );
  });

  it("lies down at once when first seen dead", () => {
    const character = createGltfCharacter(ASSETS, casual(), 1.8);
    character.update(pose({ dead: true }));
    expect(bone(character.object, "Hips").position.x).toBeCloseTo(
      DEATH_END_X,
      1,
    );
  });

  it("wears the player's shades on the head and bracelet on the left wrist", () => {
    const character = createGltfCharacter(
      ASSETS,
      appearanceOf("player", 0),
      1.85,
    );
    expect(
      bone(character.object, "Head").getObjectByName("accessory:sunglasses"),
    ).toBeDefined();
    expect(
      bone(character.object, "WristL").getObjectByName("accessory:bracelet"),
    ).toBeDefined();
  });

  it("re-dresses for a new owner: colours, height and accessories", () => {
    const character = createGltfCharacter(
      ASSETS,
      appearanceOf("player", 0),
      1.85,
    );
    const scale = character.object.children[0].scale.x;
    const next: Appearance = { ...casual(), model: "beach-man", scale: 0.92 };
    character.dress(next, 1.8);
    expect(character.object.children[0].scale.x).toBeLessThan(scale);
    expect(
      bone(character.object, "Head").getObjectByName("accessory:sunglasses"),
    ).toBeUndefined();
  });

  it("stops its mixer and detaches on dispose", () => {
    const stop = vi.spyOn(AnimationMixer.prototype, "stopAllAction");
    const character = createGltfCharacter(ASSETS, casual(), 1.8);
    const scene = new Group().add(character.object);
    character.dispose();
    expect(stop).toHaveBeenCalled();
    expect(character.object.parent).toBeNull();
    expect(scene.children).toHaveLength(0);
  });

  it("animates a far character every other frame with both frames' time", () => {
    const near = createGltfCharacter(ASSETS, casual(), 1.8);
    const far = createGltfCharacter(ASSETS, casual(), 1.8);
    for (let frame = 0; frame < 30; frame += 1) {
      near.update(pose({ speed: 1.5 }));
      far.update(pose({ speed: 1.5, far: true }));
    }
    expect(bone(far.object, "Hips").position.x).toBeCloseTo(
      bone(near.object, "Hips").position.x,
      1,
    );
  });
});
