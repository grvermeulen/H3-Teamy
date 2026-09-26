/**
 * A posable 3D person: one skinned mesh of a look, driven each frame by {@link poseFor}, holding
 * its weapon in the right hand and lying down when dead.
 */
import { Group, type Bone, type Object3D } from "three";
import { LOOKS, type CharacterLook } from "./characterLooks";
import {
  poseFor,
  rotationOf,
  type HeldWeapon,
  type PoseInput,
} from "./characterPose";
import {
  BONES,
  buildCharacterMesh,
  proportionsOf,
  type BoneName,
} from "./characterRig";
import { createWeaponModel } from "./weapons3d";

/** A character in the scene. */
export type Character3d = {
  /** Place and turn this (`position`, `rotation.y`); the character faces its local +X. */
  object: Object3D;
  /** Poses the character for this frame. */
  update(pose: PoseInput): void;
  /** Detaches the character and frees its skeleton; the shared geometry and materials stay. */
  dispose(): void;
};

/** Tipping the body over about its forward axis lays it on its left side. */
const LYING_TURN_RAD = -Math.PI / 2;
/** A lying body's side rests this share of its shoulder half-width above the ground. */
const LYING_LIFT_SHARE = 0.72;
/** Where a held weapon's grip sits in the hand bone's frame: the centre of the fist. */
const GRIP_OFFSET: [number, number, number] = [0.004, -0.052, 0];

/** Swaps the model in a hand as the held weapon changes. */
function createWeaponSlot(hand: Bone): {
  hold(weapon: HeldWeapon | null): void;
} {
  let held: HeldWeapon | null = null;
  let model: Object3D | null = null;
  return {
    hold(weapon) {
      if (weapon === held) return;
      model?.removeFromParent();
      held = weapon;
      model = weapon === null ? null : createWeaponModel(weapon);
      if (!model || model.children.length === 0) {
        model = null;
        return;
      }
      model.position.set(...GRIP_OFFSET);
      hand.add(model);
    },
  };
}

/** The mesh's bones by name. */
function bonesByName(bones: Bone[]): Record<BoneName, Bone> {
  return Object.fromEntries(
    BONES.map((name, index) => [name, bones[index]]),
  ) as Record<BoneName, Bone>;
}

/** Stands the body up, or lays it on its side with the pelvis over the object's origin. */
function layDown(
  body: Object3D,
  lying: boolean,
  pelvisHeight: number,
  lift: number,
): void {
  if (lying) {
    body.rotation.x = LYING_TURN_RAD;
    body.position.set(0, lift, pelvisHeight);
  } else {
    body.rotation.x = 0;
    body.position.set(0, 0, 0);
  }
}

/**
 * A new character of a look, posed at rest until its first update.
 *
 * @param look - What it wears.
 * @param vestHue - Vest hue in turns for another player; ignored for other looks.
 * @returns The character; call `update` every frame and `dispose` when it leaves.
 */
export function createCharacter(
  look: CharacterLook,
  vestHue?: number,
): Character3d {
  const spec = LOOKS[look];
  const mesh = buildCharacterMesh(spec, vestHue);
  const bones = bonesByName(mesh.skeleton.bones);
  const body = new Group();
  body.add(mesh);
  const object = new Group();
  object.name = `character:${look}`;
  object.add(body);
  const lift = (proportionsOf(spec).shoulderWidth / 2) * LYING_LIFT_SHARE;
  const slot = createWeaponSlot(bones.handR);
  return {
    object,
    update(input) {
      const pose = poseFor(input);
      for (const name of BONES)
        bones[name].rotation.set(...rotationOf(pose.rotations, name));
      bones.pelvis.position.y = pose.pelvisHeight;
      layDown(body, pose.lying, pose.pelvisHeight, lift);
      slot.hold(input.weapon);
    },
    dispose() {
      slot.hold(null);
      object.removeFromParent();
      mesh.skeleton.dispose();
    },
  };
}
