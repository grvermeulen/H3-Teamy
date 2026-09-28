/**
 * The first-person view model: the player's own forearms and fists, in the player's skin tone with
 * the bead bracelet, holding the current weapon. It bobs with the stride, kicks on each shot,
 * throws a punch or swings the bat, and dips out and back in when the weapon changes. Aiming down
 * the sights (aim spec §5) it brings the gun in to the middle, sights on the crosshair and the bob
 * stilled; the rifle's scope takes over from its model once it is fully up.
 *
 * Everything is in camera space (−Z ahead, +Y up, +X right): attach {@link ViewModel.object} to
 * the camera. It uses the lit character material, so the camera must be in a lit scene. A gun's
 * shot flashes at its own barrel here: the world's muzzle flash sits just ahead of the eye in
 * first person, so the effects leave it out there.
 */
import {
  Group,
  IcosahedronGeometry,
  Mesh,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import type { WeaponKind } from "../sim/types";
import { isScoped } from "./cameraRig";
import { LOOKS } from "./characterLooks";
import { RUN_SPEED_MPS, RUN_STRIDE_M, WALK_STRIDE_M } from "./characterPose";
import { characterMaterials } from "./characterRig";
import {
  createFireballMaterial,
  type FireballMaterial,
} from "./fireballMaterial";
import { block, mergeParts, shade, type Vec3 } from "./lowPoly";
import { createWeaponModel, muzzleTipOf } from "./weapons3d";

/** What the view model follows each frame. */
export type ViewModelInput = {
  weapon: WeaponKind;
  /** Tick of the local player's latest shot or swing, or `null` before the first. */
  firedTick: number | null;
  /** The current simulation tick. */
  tick: number;
  /** The player's ground speed, m/s. */
  speed: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** How far the sights are up, 0 (at the hip, the default) … 1. */
  sights?: number;
};

/** The hands and weapon in front of the first-person camera. */
export type ViewModel = {
  /** Attach to the camera. */
  object: Object3D;
  update(input: ViewModelInput): void;
  /**
   * Where the held gun's barrel ends in the world, as posed by the last `update` and seen through
   * the camera the view model hangs on — where your shots are seen to leave from in first person.
   *
   * @param target - Receives the world position; untouched without a gun.
   * @returns `false` for fists and the bat.
   */
  muzzleWorld(target: Vector3): boolean;
  /** Detaches the view model and frees its hand geometry. */
  dispose(): void;
};

/** A shot's kick has fully recovered after this long, seconds. */
export const VIEW_RECOIL_RECOVERY_S = 0.22;
/** A shot older than this many ticks when first seen is not kicked (e.g. on entering the view). */
const FRESH_SHOT_TICKS = 3;
/** How far a full kick pushes the hands back toward the camera, metres. */
const KICK_BACK_M = 0.06;
/** How far a full kick tips the muzzle up, radians. */
const KICK_PITCH_RAD = 0.12;
/** How long lowering one weapon and raising the next takes, seconds. */
const SWAP_S = 0.3;
/** How far the hands dip below view while swapping, metres. */
const SWAP_DROP_M = 0.3;
/** Side-to-side sway per stride and dip per step at full speed, metres. */
const BOB_SWAY_M = 0.012;
const BOB_DIP_M = 0.018;
/** The bob reaches full size at this speed, m/s. */
const BOB_FULL_SPEED_MPS = 5.5;
/** A slow breathing sway while standing: size (metres) and rate (radians per second). */
const IDLE_SWAY_M = 0.003;
const IDLE_SWAY_RATE = 1.7;
/** How the forearms run back from the fists toward the bottom of the screen, radians. */
const ARM_PITCH_RAD = 0.45;
const ARM_YAW_RAD = 0.3;

/**
 * How big the hands are drawn against the layouts below, which are measured for full-size arms a
 * forearm's length from the eye: at full size a pistol and both hands filled most of the lower
 * half of the screen. Scaled down about {@link LAYOUT_ANCHOR} and moved out toward the corner by
 * {@link placeViewModel}, the gun and hands take about a quarter of the lower-right quadrant.
 */
export const VIEW_MODEL_SCALE = 0.48;
/** With the sights up the hands grow to this size, so the gun reads under the crosshair. */
export const SIGHTS_SCALE = 0.75;
/** The typical grip the layouts are drawn around, camera space; it keeps its depth when scaled. */
const LAYOUT_ANCHOR: Vec3 = [0.13, -0.13, -0.36];
/** Where the anchor lands on screen, normalised device coordinates (right and down of centre). */
export const VIEW_MODEL_SCREEN_ANCHOR = { x: 0.62, y: -0.66 } as const;

/**
 * How long a shot's flash shows at the view model's barrel, seconds. It is lit on the shot's own
 * frame and dimmed only by later ones, so even a frame longer than this draws it once.
 */
export const VIEW_FLASH_S = 0.06;
/** The flash's warm white-yellow. */
const VIEW_FLASH_COLOUR = 0xffd27a;
/** The flash's radius across the barrel at the shot, metres in the layouts' full size. */
const VIEW_FLASH_RADIUS_M = 0.07;
/** It is this many times longer along the barrel than across. */
const VIEW_FLASH_STRETCH = 1.8;
/** It shrinks to this share of its size as it fades. */
const VIEW_FLASH_MIN_SHARE = 0.6;
/** Faceting of the flash ball: enough to read as round once it glows. */
const VIEW_FLASH_DETAIL = 1;

/** Straight ahead, in camera space. */
const AHEAD: Vec3 = [0, 0, -1];

/**
 * Where each gun's sights are, weapon space (grip at the origin, barrel along +X): the top of the
 * pistol's slide, the front sight post, the shotgun's barrel rib, the launcher's sight on the left
 * of its tube. Aimed down, this point sits on the crosshair with the barrel running straight ahead
 * under it. Fists and the bat have none.
 */
const SIGHTS: Partial<Record<WeaponKind, Vec3>> = {
  pistol: [0.14, 0.076, 0],
  uzi: [0.17, 0.11, 0],
  shotgun: [0.6, 0.092, 0],
  rifle: [0.5, 0.1175, 0],
  rocket: [0.12, 0.195, -0.05],
};
/** With the sights up the gun comes this much closer to the eye, metres in the layouts' size. */
const SIGHTS_PULL_M = 0.04;

/**
 * Where a weapon's sights are, in its own space.
 *
 * @param weapon - The weapon.
 * @returns The sight point, or `null` for a weapon without sights.
 */
export function sightOf(weapon: WeaponKind): Vec3 | null {
  return SIGHTS[weapon] ?? null;
}

/** Where the hands hold a weapon, in camera space. */
type ViewLayout = {
  /** The right fist, around the weapon's grip. */
  grip: Vec3;
  /** Where the weapon's barrel (its +X) points. */
  aim: Vec3;
  /** The left hand's hold on the weapon, in the weapon's own space; `null` hides the left arm. */
  support: Vec3 | null;
  /** A free left fist (bare hands), in camera space. */
  leftFist?: Vec3;
  /** Where the right fist and weapon go at the peak of a punch or swing. */
  strike?: { grip: Vec3; aim: Vec3 };
  /** How hard a shot kicks, relative to a pistol. */
  kick: number;
};

/** Bare fists up in a guard, the right one thrown on a punch. */
const FISTS: ViewLayout = {
  grip: [0.16, -0.15, -0.38],
  aim: AHEAD,
  support: null,
  leftFist: [-0.16, -0.15, -0.38],
  strike: { grip: [0.04, -0.09, -0.66], aim: AHEAD },
  kick: 0,
};

/**
 * The first-person layout of every weapon, set for the first-person camera's 70° field of view:
 * grips in the lower right, barrels running in toward the crosshair.
 */
const LAYOUTS: Record<WeaponKind, ViewLayout> = {
  fist: FISTS,
  cannon: FISTS,
  pistol: {
    grip: [0.12, -0.125, -0.36],
    aim: AHEAD,
    support: [0, -0.03, -0.07],
    kick: 1,
  },
  uzi: { grip: [0.13, -0.13, -0.36], aim: AHEAD, support: null, kick: 0.5 },
  shotgun: {
    grip: [0.13, -0.12, -0.32],
    aim: AHEAD,
    support: [0.34, 0.01, 0],
    kick: 1.6,
  },
  rifle: {
    grip: [0.13, -0.11, -0.32],
    aim: AHEAD,
    support: [0.26, 0.02, 0],
    kick: 0.8,
  },
  rocket: {
    grip: [0.22, -0.25, -0.55],
    aim: AHEAD,
    support: [0.3, 0.01, 0],
    kick: 1.8,
  },
  bat: {
    grip: [0.26, -0.28, -0.45],
    aim: [0.1, 0.9, 0.35],
    support: [-0.095, 0, 0],
    strike: { grip: [-0.02, -0.2, -0.5], aim: [-0.9, 0.1, -0.4] },
    kick: 0,
  },
};

/**
 * The player's forearm and fist in their skin tone — the right one with the bead bracelet —
 * shared by the first-person hands and the cockpit's hands on the wheel.
 *
 * @param side - `L` or `R`; the thumb sits on the inner side.
 * @returns A new merged geometry: fist at the origin, knuckles up (+Y), forearm running back
 *   along +Z.
 */
export function armGeometry(side: "L" | "R"): BufferGeometry {
  const skin = LOOKS.player.skin;
  const inward = side === "R" ? -1 : 1;
  const parts = [
    block({
      size: [0.085, 0.09, 0.1],
      at: [0, 0, 0],
      colour: skin,
      chamfer: 0.45,
    }),
    block({
      size: [0.088, 0.028, 0.03],
      at: [0, 0.022, -0.048],
      colour: shade(skin, 0.92),
      chamfer: 0.4,
    }),
    block({
      size: [0.03, 0.032, 0.06],
      at: [inward * 0.045, 0.028, -0.018],
      colour: shade(skin, 0.96),
      chamfer: 0.4,
    }),
    block({
      size: [0.11, 0.42, 0.1],
      at: [0, -0.005, 0.25],
      colour: skin,
      chamfer: 0.5,
      taper: 0.78,
      rotation: [Math.PI / 2, 0, 0],
    }),
  ];
  if (side === "R") parts.push(...braceletBeads());
  return mergeParts(parts);
}

/** Size of one bracelet bead, metres. */
const BEAD_M = 0.015;

/** The player's bead bracelet around the right wrist. */
function braceletBeads(): BufferGeometry[] {
  const bracelet = LOOKS.player.extras.find(
    (extra) => extra.kind === "bracelet",
  );
  const colours = bracelet?.kind === "bracelet" ? bracelet.colours : [];
  const beads = 14;
  const radius = 0.05;
  return colours.length === 0
    ? []
    : Array.from({ length: beads }, (_, index) => {
        const angle = (index / beads) * Math.PI * 2;
        return block({
          size: [BEAD_M, BEAD_M, BEAD_M],
          at: [Math.cos(angle) * radius, Math.sin(angle) * radius, 0.075],
          colour: colours[index % colours.length],
          rotation: [0, 0, angle],
        });
      });
}

/** A forearm as a posable group, angled back toward its side of the screen. */
function createArm(side: "L" | "R"): { group: Group; mesh: Mesh } {
  const mesh = new Mesh(armGeometry(side), characterMaterials().body);
  const group = new Group();
  group.add(mesh);
  group.rotation.set(ARM_PITCH_RAD, (side === "R" ? 1 : -1) * ARM_YAW_RAD, 0);
  return { group, mesh };
}

/** A weapon's barrel axis in its own space. */
const WEAPON_FORWARD = new Vector3(1, 0, 0);

/** The rotation that turns the weapon's +X toward `aim`. */
function aimQuaternion(aim: Vec3): Quaternion {
  return new Quaternion().setFromUnitVectors(
    WEAPON_FORWARD,
    new Vector3(...aim).normalize(),
  );
}

/**
 * A layout with its points and turns built once and shared by every view model, so placing the
 * hands each frame allocates nothing. Read-only: copy from it, never write to it.
 */
type PreparedLayout = {
  grip: Vector3;
  aim: Quaternion;
  support: Vector3 | null;
  leftFist: Vector3 | null;
  strike: { grip: Vector3; aim: Quaternion } | null;
};

const preparedLayouts = new Map<WeaponKind, PreparedLayout>();

/** The prepared layout of a weapon, built on first use. */
function preparedLayout(weapon: WeaponKind): PreparedLayout {
  const cached = preparedLayouts.get(weapon);
  if (cached) return cached;
  const { grip, aim, support, leftFist, strike } = LAYOUTS[weapon];
  const prepared: PreparedLayout = {
    grip: new Vector3(...grip),
    aim: aimQuaternion(aim),
    support: support ? new Vector3(...support) : null,
    leftFist: leftFist ? new Vector3(...leftFist) : null,
    strike: strike
      ? { grip: new Vector3(...strike.grip), aim: aimQuaternion(strike.aim) }
      : null,
  };
  preparedLayouts.set(weapon, prepared);
  return prepared;
}

/** Mutable per-frame state. */
type ViewState = {
  weapon: WeaponKind | null;
  model: Object3D | null;
  lastFiredTick: number | null;
  /** 1 on a shot, falling to 0 over {@link VIEW_RECOIL_RECOVERY_S}. */
  kick: number;
  /** 1 as the weapon changes, falling to 0 over {@link SWAP_S}. */
  swap: number;
  stridePhase: number;
  seconds: number;
  /** Where the held gun's muzzle is, weapon space; `null` for fists and the bat. */
  tip: Vec3 | null;
  /** Seconds the muzzle flash still shows, from {@link VIEW_FLASH_S} at a shot down to 0. */
  flash: number;
};

/** The glowing ball at the barrel on a shot. */
type FlashMesh = Mesh<IcosahedronGeometry, FireballMaterial>;

/** The parts the view model moves. */
type ViewParts = {
  /** The view model's root, placed and sized for the lens by {@link placeViewModel}. */
  root: Group;
  rig: Group;
  holder: Group;
  right: Group;
  left: Group;
  flash: FlashMesh;
};

/** Swaps the held model when the weapon changes. */
function syncWeapon(
  state: ViewState,
  parts: ViewParts,
  weapon: WeaponKind,
): void {
  if (weapon === state.weapon) return;
  state.model?.removeFromParent();
  state.weapon = weapon;
  state.model = createWeaponModel(weapon);
  parts.holder.add(state.model);
  state.swap = 1;
  state.tip = muzzleTipOf(weapon);
  if (state.tip) parts.flash.position.set(...state.tip);
}

/** Starts a kick, and a gun's muzzle flash, when a new, fresh shot arrives. */
function syncShot(state: ViewState, input: ViewModelInput): void {
  if (input.firedTick === null || input.firedTick === state.lastFiredTick)
    return;
  state.lastFiredTick = input.firedTick;
  if (input.tick - input.firedTick > FRESH_SHOT_TICKS) return;
  state.kick = 1;
  if (state.tip) state.flash = VIEW_FLASH_S;
}

/** The muzzle flash: hidden between shots, set at `holder`'s barrel tip by the weapon swap. */
function createFlashMesh(): FlashMesh {
  const flash = new Mesh(
    new IcosahedronGeometry(1, VIEW_FLASH_DETAIL),
    createFireballMaterial(VIEW_FLASH_COLOUR),
  );
  flash.name = "muzzleFlash";
  flash.visible = false;
  return flash;
}

/**
 * Shows the flash for what is left of it: full size and bright on the shot's frame, shrinking
 * and fading after; stretched along the barrel.
 */
function placeFlash(flash: FlashMesh, state: ViewState): void {
  const share = state.flash / VIEW_FLASH_S;
  flash.visible = share > 0;
  if (!flash.visible) return;
  const size =
    VIEW_FLASH_RADIUS_M *
    (VIEW_FLASH_MIN_SHARE + (1 - VIEW_FLASH_MIN_SHARE) * share);
  flash.scale.set(size * VIEW_FLASH_STRETCH, size, size);
  flash.material.uniforms.uOpacity.value = share;
}

/** Where the holder goes with the sights up; reused, so aiming allocates nothing. */
const sightsGrip = new Vector3();

/**
 * Where the holder puts the sight point on the camera's axis, barrel ahead, given where the root
 * sits for the lens. The aim turns the weapon's +X to −Z and its +Z to +X, so the sight lies
 * `(z, y, −x)` from the grip.
 */
function placeSights(
  root: Object3D,
  layout: PreparedLayout,
  sight: Vec3,
): Vector3 {
  const scale = root.scale.x;
  return sightsGrip.set(
    -root.position.x / scale - sight[2],
    -root.position.y / scale - sight[1],
    layout.grip.z + SIGHTS_PULL_M,
  );
}

/**
 * Places the weapon and both hands for the layout, blending toward a strike by `strike` and
 * toward the sights pose by `sights`. Writes only into the parts' own position and quaternion,
 * so it allocates nothing.
 */
function placeHands(
  parts: ViewParts,
  layout: PreparedLayout,
  strike: number,
  sights: { share: number; point: Vec3 | null },
): void {
  const { holder, right, left } = parts;
  holder.position.copy(layout.grip);
  holder.quaternion.copy(layout.aim);
  if (layout.strike) {
    holder.position.lerp(layout.strike.grip, strike);
    holder.quaternion.slerp(layout.strike.aim, strike);
  }
  if (sights.point && sights.share > 0)
    holder.position.lerp(
      placeSights(parts.root, layout, sights.point),
      sights.share,
    );
  right.position.copy(holder.position);
  left.visible = layout.support !== null || layout.leftFist !== null;
  if (layout.support) {
    left.position
      .copy(layout.support)
      .applyQuaternion(holder.quaternion)
      .add(holder.position);
  } else if (layout.leftFist) {
    left.position.copy(layout.leftFist);
  }
}

/** Bob, idle sway, kick and the swap dip, applied to the whole rig; the sights still the bob. */
function placeRig(
  rig: Group,
  state: ViewState,
  layout: ViewLayout,
  speed: number,
  sights: number,
): void {
  const steady = 1 - sights;
  const amount = Math.min(1, speed / BOB_FULL_SPEED_MPS) * steady;
  const kick = state.kick * state.kick * layout.kick;
  const sway = Math.sin(state.seconds * IDLE_SWAY_RATE) * IDLE_SWAY_M * steady;
  rig.position.set(
    Math.sin(state.stridePhase) * BOB_SWAY_M * amount,
    -((1 - Math.cos(2 * state.stridePhase)) / 2) * BOB_DIP_M * amount +
      sway -
      SWAP_DROP_M * state.swap * state.swap,
    KICK_BACK_M * kick,
  );
  rig.rotation.set(KICK_PITCH_RAD * kick, 0, 0);
}

/** Moves time on: the kick and swap recover, the stride advances. */
function advance(state: ViewState, input: ViewModelInput): void {
  const stride = input.speed > RUN_SPEED_MPS ? RUN_STRIDE_M : WALK_STRIDE_M;
  state.kick = Math.max(0, state.kick - input.dt / VIEW_RECOIL_RECOVERY_S);
  state.flash = Math.max(0, state.flash - input.dt);
  state.swap = Math.max(0, state.swap - input.dt / SWAP_S);
  state.stridePhase += ((input.dt * input.speed) / stride) * Math.PI * 2;
  state.seconds += input.dt;
}

/** A view model's state before its first frame: nothing held, at rest. */
function createViewState(): ViewState {
  return {
    weapon: null,
    model: null,
    lastFiredTick: null,
    kick: 0,
    swap: 0,
    stridePhase: 0,
    seconds: 0,
    tip: null,
    flash: 0,
  };
}

/** Poses the hands and gun for a frame: the weapon, the shot's kick, the sights, the bob. */
function poseViewModel(
  state: ViewState,
  parts: ViewParts,
  input: ViewModelInput,
): void {
  const point = sightOf(input.weapon);
  const share = point ? (input.sights ?? 0) : 0;
  syncWeapon(state, parts, input.weapon);
  syncShot(state, input);
  placeHands(parts, preparedLayout(input.weapon), state.kick, {
    share,
    point,
  });
  placeRig(parts.rig, state, LAYOUTS[input.weapon], input.speed, share);
  parts.rig.visible = !(isScoped(input.weapon) && share >= 1);
  placeFlash(parts.flash, state);
  advance(state, input);
}

/**
 * The player's hands and weapon for the first-person view.
 *
 * @returns A view model; call `update` every frame while in first person.
 */
export function createViewModel(): ViewModel {
  const rig = new Group();
  const holder = new Group();
  const rightArm = createArm("R");
  const leftArm = createArm("L");
  const flash = createFlashMesh();
  holder.add(flash);
  rig.add(holder, rightArm.group, leftArm.group);
  const object = new Group();
  object.name = "viewModel";
  object.add(rig);
  const parts: ViewParts = {
    root: object,
    rig,
    holder,
    right: rightArm.group,
    left: leftArm.group,
    flash,
  };
  const state = createViewState();
  return {
    object,
    update: (input) => poseViewModel(state, parts, input),
    muzzleWorld(target) {
      if (!state.tip) return false;
      holder.updateWorldMatrix(true, false);
      holder.localToWorld(target.set(...state.tip));
      return true;
    },
    dispose() {
      object.removeFromParent();
      rightArm.mesh.geometry.dispose();
      leftArm.mesh.geometry.dispose();
      flash.geometry.dispose();
      flash.material.dispose();
    },
  };
}

/** Degrees to radians, halved: a field of view's half angle. */
const HALF_ANGLE_PER_DEGREE = Math.PI / 360;

/**
 * Sizes and places the view model for a camera's lens: shrinks it by {@link VIEW_MODEL_SCALE}
 * about {@link LAYOUT_ANCHOR}, keeping the anchor's depth, and moves the anchor to
 * {@link VIEW_MODEL_SCREEN_ANCHOR} on screen — so the gun sits at the same spot on a wide monitor
 * and a narrow phone, and the forearms still run off the bottom-right edge. With the sights up the
 * hands grow toward {@link SIGHTS_SCALE}. Allocates nothing.
 *
 * @param object - The view model's {@link ViewModel.object}, attached to `camera`.
 * @param camera - The camera it is drawn through, with its field of view and aspect set.
 * @param sights - How far the sights are up, 0 (at the hip, the default) … 1.
 */
export function placeViewModel(
  object: Object3D,
  camera: Pick<PerspectiveCamera, "fov" | "aspect">,
  sights = 0,
): void {
  const [anchorX, anchorY, anchorZ] = LAYOUT_ANCHOR;
  const halfHeight = -anchorZ * Math.tan(camera.fov * HALF_ANGLE_PER_DEGREE);
  const halfWidth = halfHeight * camera.aspect;
  const scale = VIEW_MODEL_SCALE + (SIGHTS_SCALE - VIEW_MODEL_SCALE) * sights;
  object.scale.setScalar(scale);
  object.position.set(
    VIEW_MODEL_SCREEN_ANCHOR.x * halfWidth - scale * anchorX,
    VIEW_MODEL_SCREEN_ANCHOR.y * halfHeight - scale * anchorY,
    anchorZ * (1 - scale),
  );
}
