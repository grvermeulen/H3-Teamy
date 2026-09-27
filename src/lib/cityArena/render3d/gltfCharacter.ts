/**
 * A {@link Character3d} over a packed glTF model (spec §7): a `SkeletonUtils` clone of the model
 * (sharing its geometry), its own palette material coloured by the appearance, the rig's clips
 * layered by {@link createGltfAnimator}, the weapon in the right hand and accessories on their
 * bones. It faces local +X like the procedural characters and stands as tall as their look. A
 * pooled character is re-dressed for its next owner with {@link GltfCharacter.dress}.
 */
import { Group, Vector3, type Object3D, type SkinnedMesh } from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import type { CharacterModelKey } from "../characterManifest";
import { SIM_STEP_S } from "../sim/player";
import type { WeaponKind } from "../sim/types";
import { createAccessory, type AccessoryBone } from "./characterAccessories";
import {
  createClipMix,
  clipMixInto,
  type GaitStride,
} from "./characterAnimation";
import type { Appearance } from "./characterAppearance";
import type { CharacterAssets, ModelAsset, RigAsset } from "./characterAssets";
import {
  createPaletteMaterial,
  hidePaletteSlot,
  writePaletteSlot,
  type PaletteMaterial,
} from "./characterPalette";
import type { PoseInput } from "./characterPose";
import type { Character3d } from "./characters";
import { createGltfAnimator, type GltfAnimator } from "./gltfAnimator";
import type { Vec3 } from "./lowPoly";
import { createWeaponModel, muzzleTipOf } from "./weapons3d";

/** A glTF character, which can be re-dressed for another owner of the same model. */
export type GltfCharacter = Character3d & {
  readonly model: CharacterModelKey;
  /**
   * Recolours, rescales and re-accessorises the character and stands it back at idle.
   *
   * @param appearance - The new owner's appearance; its model must be this character's.
   * @param height - Standing height of the new owner's look, metres.
   */
  dress(appearance: Appearance, height: number): void;
};

/** The packs' models face +Z; the game's characters face +X. */
const FACE_PLUS_X_RAD = Math.PI / 2;
/** Women stand this share of a man's height. */
const FEMALE_HEIGHT_SHARE = 0.95;
/** The right hand, which holds the weapon (three.js drops the `.` from `Wrist.R`). */
const HAND_BONE = "WristR";
/** The bones accessories hang on. */
const ACCESSORY_BONES: readonly AccessoryBone[] = ["Head", "Chest", "WristL"];
/** A frame never steps the clips further than this, seconds (a stalled tab coming back). */
const MAX_STEP_S = 0.25;

/**
 * How a weapon sits in the hand, in the wrist bone's frame (metres; y runs along the fingers, −x
 * is up when the arm points ahead, z out of the back of the hand). A gun's barrel runs along the
 * fingers, its top up; the bat leaves the fist on the thumb side like a sword.
 */
type Hold = { rotation: Vec3; grip: Vec3 };
const POINT_HOLD: Hold = {
  rotation: [0, 0, Math.PI / 2],
  grip: [0.02, 0.075, -0.015],
};
const FIST_HOLD: Hold = {
  rotation: [0, 0, Math.PI],
  grip: [0.02, 0.075, -0.015],
};

/** The weapon in the hand, swapped as the held weapon changes. */
type WeaponSlot = {
  hold(weapon: WeaponKind | null): void;
  muzzleWorld(target: Vector3): boolean;
};

/** Puts a weapon in a hand bone whose units are `unit` metres⁻¹, and finds its muzzle. */
function createWeaponSlot(hand: Object3D, unit: number): WeaponSlot {
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
      const hold = weapon === "bat" ? FIST_HOLD : POINT_HOLD;
      model.position.set(
        hold.grip[0] * unit,
        hold.grip[1] * unit,
        hold.grip[2] * unit,
      );
      model.rotation.set(...hold.rotation);
      model.scale.setScalar(unit);
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

/** A model's clone: the scene, its mesh in its own material, the named bones and their unit. */
type Body = {
  root: Object3D;
  mesh: SkinnedMesh;
  palette: PaletteMaterial;
  hand: Object3D;
  bones: Record<AccessoryBone, Object3D>;
  /** Metres per bone-local unit's reciprocal: scale a metre-sized child by this. */
  unit: number;
};

/** A named node of the clone; a model without it is broken. */
function nodeNamed(root: Object3D, name: string): Object3D {
  const node = root.getObjectByName(name);
  if (!node) throw new Error(`glTF character: no bone ${name}`);
  return node;
}

/** Clones a model and gives the clone its own palette material. */
function cloneBody(model: ModelAsset): Body {
  const root = cloneSkinned(model.scene);
  let mesh: SkinnedMesh | null = null;
  root.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh) mesh = node as SkinnedMesh;
  });
  if (!mesh)
    throw new Error(`glTF character: ${model.key} has no skinned mesh`);
  const found: SkinnedMesh = mesh;
  const palette = createPaletteMaterial();
  found.material = palette.material;
  const hand = nodeNamed(root, HAND_BONE);
  root.updateMatrixWorld(true);
  const unit = 1 / hand.getWorldScale(new Vector3()).x;
  const bones = {} as Record<AccessoryBone, Object3D>;
  for (const name of ACCESSORY_BONES) bones[name] = nodeNamed(root, name);
  return { root, mesh: found, palette, hand, bones, unit };
}

/** The model's own colours with the appearance's tints over them, and its hidden slots. */
function applyPalette(
  body: Body,
  model: ModelAsset,
  appearance: Appearance,
): void {
  body.palette.colours.set(model.palette);
  for (const [slot, hex] of Object.entries(appearance.tints)) {
    const index = model.slots.indexOf(slot);
    if (index >= 0) writePaletteSlot(body.palette.colours, index, hex);
  }
  for (const slot of appearance.hidden) {
    const index = model.slots.indexOf(slot);
    if (index >= 0) hidePaletteSlot(body.palette.colours, index);
  }
}

/** Takes off the accessories worn and puts on the appearance's. */
function wear(
  body: Body,
  worn: Object3D[],
  appearance: Appearance,
  female: boolean,
): void {
  for (const item of worn) item.removeFromParent();
  worn.length = 0;
  for (const extra of appearance.extras) {
    const { bone, object } = createAccessory(extra, female);
    object.scale.setScalar(body.unit);
    body.bones[bone].add(object);
    worn.push(object);
  }
}

/** Frame timing: the last tick seen, and time held back while a far character skips a frame. */
type Clock = { lastTick: number | null; pending: number; skipNext: boolean };

/** Seconds since the previous frame: the caller's, else the ticks that passed. */
function frameStep(clock: Clock, pose: PoseInput): number {
  const ticks = clock.lastTick === null ? 0 : pose.tick - clock.lastTick;
  clock.lastTick = pose.tick;
  const step = pose.dt ?? ticks * SIM_STEP_S;
  return Math.min(MAX_STEP_S, Math.max(0, step));
}

/** The time to advance the clips by this frame, or `null` when a far character skips it. */
function throttle(clock: Clock, far: boolean, dt: number): number | null {
  clock.pending += dt;
  const skip = far && clock.skipNext;
  clock.skipNext = far && !skip;
  if (skip) return null;
  const step = clock.pending;
  clock.pending = 0;
  return step;
}

/** Everything one glTF character holds. */
type Parts = {
  object: Group;
  body: Body;
  scaled: Group;
  model: ModelAsset;
  rig: RigAsset;
  animator: GltfAnimator;
  slot: WeaponSlot;
  stride: GaitStride;
  worn: Object3D[];
  clock: Clock;
};

/** Builds the character's objects, facing +X. */
function buildParts(assets: CharacterAssets, key: CharacterModelKey): Parts {
  const model = assets.models[key];
  const rig = assets.rigs[model.rig];
  const body = cloneBody(model);
  const scaled = new Group();
  scaled.rotation.y = FACE_PLUS_X_RAD;
  scaled.add(body.root);
  const object = new Group();
  object.name = `character:gltf:${key}`;
  object.add(scaled);
  return {
    object,
    body,
    scaled,
    model,
    rig,
    animator: createGltfAnimator(body.root, rig),
    slot: createWeaponSlot(body.hand, body.unit),
    stride: { walkM: rig.stride.walkM, runM: rig.stride.runM },
    worn: [],
    clock: { lastTick: null, pending: 0, skipNext: false },
  };
}

/** Dresses the character for an appearance and a look's height. */
function dressParts(
  parts: Parts,
  appearance: Appearance,
  height: number,
): void {
  const { model, rig } = parts;
  applyPalette(parts.body, model, appearance);
  const share = model.female ? FEMALE_HEIGHT_SHARE : 1;
  const scale = (height * appearance.scale * share) / rig.referenceHeight;
  parts.scaled.scale.setScalar(scale);
  parts.stride.walkM = rig.stride.walkM * scale;
  parts.stride.runM = rig.stride.runM * scale;
  wear(parts.body, parts.worn, appearance, model.female);
  parts.animator.reset();
  parts.clock.lastTick = null;
  parts.clock.pending = 0;
}

/**
 * A glTF character in an appearance, at idle until its first update.
 *
 * @param assets - The loaded characters.
 * @param appearance - Model, colours, height and accessories.
 * @param height - Standing height of the look, metres (the appearance's scale applies on top).
 * @returns The character; call `update` every frame and `dispose` when it leaves.
 */
export function createGltfCharacter(
  assets: CharacterAssets,
  appearance: Appearance,
  height: number,
): GltfCharacter {
  const parts = buildParts(assets, appearance.model);
  const mix = createClipMix();
  dressParts(parts, appearance, height);
  const { object, animator, slot, clock } = parts;
  return {
    object,
    model: parts.model.key,
    update(pose) {
      const dt = frameStep(clock, pose);
      slot.hold(pose.weapon);
      animator.observe(clipMixInto(pose, parts.stride, mix));
      const step = throttle(clock, pose.far === true, dt);
      if (step !== null && object.visible) animator.advance(step);
    },
    muzzleWorld: (target) => slot.muzzleWorld(target),
    dress: (next, nextHeight) => dressParts(parts, next, nextHeight),
    dispose() {
      slot.hold(null);
      wear(parts.body, parts.worn, { ...appearance, extras: [] }, false);
      animator.dispose();
      parts.body.palette.material.dispose();
      parts.body.mesh.skeleton.dispose();
      object.removeFromParent();
    },
  };
}

/**
 * Whether a character is a glTF one (and can be re-dressed).
 *
 * @param character - Any character.
 * @returns `true` for a {@link GltfCharacter}.
 */
export function isGltfCharacter(
  character: Character3d,
): character is GltfCharacter {
  return "dress" in character;
}
