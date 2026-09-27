/**
 * A posable 3D person. The procedural one ({@link createCharacter}) is one skinned mesh of a look,
 * driven each frame by {@link poseFor}, holding its weapon in the right hand and lying down when
 * dead; it draws until the glTF cast has loaded, and wherever that cast cannot.
 * {@link createCharacterFactory} picks between the two.
 */
import { Group, type Bone, type Object3D, type Vector3 } from "three";
import {
  CHARACTER_MODEL_KEYS,
  type CharacterModelKey,
} from "../characterManifest";
import type { WeaponKind } from "../sim/types";
import { appearanceOf, modelOf } from "./characterAppearance";
import {
  characterAssetsReady,
  requestCharacterAssets,
  type CharacterAssets,
} from "./characterAssets";
import { LOOKS, type CharacterLook } from "./characterLooks";
import { createPose, poseInto, type PoseInput } from "./characterPose";
import {
  BONES,
  buildCharacterMesh,
  proportionsOf,
  type BoneName,
} from "./characterRig";
import type { CharacterWho, EntityFactories } from "./entities";
import { createGltfCharacter, isGltfCharacter } from "./gltfCharacter";
import type { Vec3 } from "./lowPoly";
import { createWeaponModel, muzzleTipOf } from "./weapons3d";

/** A character in the scene. */
export type Character3d = {
  /** Place and turn this (`position`, `rotation.y`); the character faces its local +X. */
  object: Object3D;
  /** Poses the character for this frame. */
  update(pose: PoseInput): void;
  /**
   * Where the held gun's muzzle is in the world, as posed by the last `update` — where this
   * character's shots should be seen to leave from.
   *
   * @param target - Receives the world position; untouched when there is no muzzle.
   * @returns `false` for empty hands, fists and the bat.
   */
  muzzleWorld(target: Vector3): boolean;
  /** Detaches the character and frees its skeleton; the shared geometry and materials stay. */
  dispose(): void;
};

/** Tipping the body over about its forward axis lays it on its left side. */
const LYING_TURN_RAD = -Math.PI / 2;
/** A lying body's side rests this share of its shoulder half-width above the ground. */
const LYING_LIFT_SHARE = 0.72;
/** Where a held weapon's grip sits in the hand bone's frame: the centre of the fist. */
const GRIP_OFFSET: [number, number, number] = [0.004, -0.052, 0];

/** The weapon in a hand, swapped as the held weapon changes. */
type WeaponSlot = {
  hold(weapon: WeaponKind | null): void;
  /** See {@link Character3d.muzzleWorld}. */
  muzzleWorld(target: Vector3): boolean;
};

/** Swaps the model in a hand as the held weapon changes, and finds its muzzle. */
function createWeaponSlot(hand: Bone): WeaponSlot {
  let held: WeaponKind | null = null;
  let model: Object3D | null = null;
  let tip: Vec3 | null = null;
  return {
    hold(weapon) {
      if (weapon === held) return;
      model?.removeFromParent();
      held = weapon;
      model = weapon === null ? null : createWeaponModel(weapon);
      tip = weapon === null ? null : muzzleTipOf(weapon);
      if (!model || model.children.length === 0) {
        model = null;
        return;
      }
      model.position.set(...GRIP_OFFSET);
      hand.add(model);
    },
    muzzleWorld(target) {
      if (!model || !tip) return false;
      model.updateWorldMatrix(true, false);
      model.localToWorld(target.set(tip[0], tip[1], tip[2]));
      return true;
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
  const pose = createPose();
  return {
    object,
    update(input) {
      poseInto(input, pose);
      for (let index = 0; index < BONES.length; index += 1) {
        const rotation = pose.rotations[BONES[index]];
        mesh.skeleton.bones[index].rotation.set(
          rotation[0],
          rotation[1],
          rotation[2],
        );
      }
      bones.pelvis.position.y = pose.pelvisHeight;
      layDown(body, pose.lying, pose.pelvisHeight, lift);
      slot.hold(input.weapon);
    },
    muzzleWorld: (target) => slot.muzzleWorld(target),
    dispose() {
      slot.hold(null);
      object.removeFromParent();
      mesh.skeleton.dispose();
    },
  };
}

/** At the "laag" quality, characters beyond this are drawn procedurally, metres (spec §7). */
export const GLTF_LOD_DISTANCE_M = 45;

/** The pool variant of each glTF model, interned so asking for it allocates nothing. */
const GLTF_VARIANTS = Object.fromEntries(
  CHARACTER_MODEL_KEYS.map((key) => [key, `gltf:${key}`]),
) as Record<CharacterModelKey, string>;

/** Where the character factory gets the glTF cast from; tests pass fakes. */
export type CharacterAssetSource = {
  /** The loaded characters, or `null` while loading, after a failure or before a request. */
  ready(): CharacterAssets | null;
  /** Starts loading if nothing has yet; must not allocate once it has. */
  request(): void;
};

/** The session's glTF cast. */
const LOADED_CHARACTERS: CharacterAssetSource = {
  ready: characterAssetsReady,
  request: requestCharacterAssets,
};

/** The character hooks of {@link EntityFactories}. */
export type CharacterFactory = Pick<
  EntityFactories,
  "character" | "characterVariant" | "dressCharacter"
>;

/** The loaded cast when a character for `who` should be glTF; asks for it to load otherwise. */
function gltfAssetsFor(
  source: CharacterAssetSource,
  who: CharacterWho | undefined,
): CharacterAssets | null {
  const assets = source.ready();
  if (!assets) source.request();
  return assets && who && !who.simple ? assets : null;
}

/**
 * The character factory (spec §7): the glTF cast, dressed by id, once it has loaded and while the
 * character is within the detail range; the procedural characters otherwise — before the files
 * arrive, after they fail, and far away at "laag". Asking for a character starts the loading.
 *
 * @param source - The glTF cast; the session's by default.
 * @returns The hooks for {@link EntityFactories}.
 */
export function createCharacterFactory(
  source: CharacterAssetSource = LOADED_CHARACTERS,
): CharacterFactory {
  return {
    character(look, vestHue, who) {
      const assets = gltfAssetsFor(source, who);
      if (!assets || !who) return createCharacter(look, vestHue);
      const appearance = appearanceOf(look, who.id, vestHue);
      return createGltfCharacter(assets, appearance, LOOKS[look].height);
    },
    characterVariant(look, vestHue, who) {
      if (!gltfAssetsFor(source, who))
        return vestHue === undefined ? look : null;
      return GLTF_VARIANTS[modelOf(look, who.id)];
    },
    dressCharacter(character, look, vestHue, who) {
      if (!isGltfCharacter(character)) return;
      const appearance = appearanceOf(look, who.id, vestHue);
      character.dress(appearance, LOOKS[look].height);
    },
  };
}
