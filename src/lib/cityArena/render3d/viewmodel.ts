/**
 * The first-person view model: the player's own forearms and fists, in the player's skin tone with
 * the bead bracelet, holding the current weapon. It bobs with the stride, kicks on each shot,
 * throws a punch or swings the bat, and dips out and back in when the weapon changes.
 *
 * Everything is in camera space (−Z ahead, +Y up, +X right): attach {@link ViewModel.object} to
 * the camera. It uses the lit character material, so the camera must be in a lit scene.
 */
import {
  Group,
  Mesh,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from "three";
import { LOOKS } from "./characterLooks";
import { RUN_SPEED_MPS, RUN_STRIDE_M, WALK_STRIDE_M } from "./characterPose";
import { characterMaterials } from "./characterRig";
import { block, mergeParts, shade, type Vec3 } from "./lowPoly";
import { createWeaponModel, type ModelWeapon } from "./weapons3d";

/** What the view model follows each frame. */
export type ViewModelInput = {
  weapon: ModelWeapon;
  /** Tick of the local player's latest shot or swing, or `null` before the first. */
  firedTick: number | null;
  /** The current simulation tick. */
  tick: number;
  /** The player's ground speed, m/s. */
  speed: number;
  /** Seconds since the previous frame. */
  dt: number;
};

/** The hands and weapon in front of the first-person camera. */
export type ViewModel = {
  /** Attach to the camera. */
  object: Object3D;
  update(input: ViewModelInput): void;
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

/** Straight ahead, in camera space. */
const AHEAD: Vec3 = [0, 0, -1];

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
const LAYOUTS: Record<ModelWeapon, ViewLayout> = {
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

/** Fist, knuckles, thumb and forearm, fist at the origin, forearm running back along +Z. */
function armGeometry(side: "L" | "R"): BufferGeometry {
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

const preparedLayouts = new Map<ModelWeapon, PreparedLayout>();

/** The prepared layout of a weapon, built on first use. */
function preparedLayout(weapon: ModelWeapon): PreparedLayout {
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
  weapon: ModelWeapon | null;
  model: Object3D | null;
  lastFiredTick: number | null;
  /** 1 on a shot, falling to 0 over {@link VIEW_RECOIL_RECOVERY_S}. */
  kick: number;
  /** 1 as the weapon changes, falling to 0 over {@link SWAP_S}. */
  swap: number;
  stridePhase: number;
  seconds: number;
};

/** The parts the view model moves. */
type ViewParts = { rig: Group; holder: Group; right: Group; left: Group };

/** Swaps the held model when the weapon changes. */
function syncWeapon(
  state: ViewState,
  parts: ViewParts,
  weapon: ModelWeapon,
): void {
  if (weapon === state.weapon) return;
  state.model?.removeFromParent();
  state.weapon = weapon;
  state.model = createWeaponModel(weapon);
  parts.holder.add(state.model);
  state.swap = 1;
}

/** Starts a kick when a new, fresh shot arrives. */
function syncShot(state: ViewState, input: ViewModelInput): void {
  if (input.firedTick === null || input.firedTick === state.lastFiredTick)
    return;
  state.lastFiredTick = input.firedTick;
  if (input.tick - input.firedTick <= FRESH_SHOT_TICKS) state.kick = 1;
}

/**
 * Places the weapon and both hands for the layout, blending toward a strike by `strike`. Writes
 * only into the parts' own position and quaternion, so it allocates nothing.
 */
function placeHands(
  parts: ViewParts,
  layout: PreparedLayout,
  strike: number,
): void {
  const { holder, right, left } = parts;
  holder.position.copy(layout.grip);
  holder.quaternion.copy(layout.aim);
  if (layout.strike) {
    holder.position.lerp(layout.strike.grip, strike);
    holder.quaternion.slerp(layout.strike.aim, strike);
  }
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

/** Bob, idle sway, kick and the swap dip, applied to the whole rig. */
function placeRig(
  rig: Group,
  state: ViewState,
  layout: ViewLayout,
  speed: number,
): void {
  const amount = Math.min(1, speed / BOB_FULL_SPEED_MPS);
  const kick = state.kick * state.kick * layout.kick;
  const sway = Math.sin(state.seconds * IDLE_SWAY_RATE) * IDLE_SWAY_M;
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
  state.swap = Math.max(0, state.swap - input.dt / SWAP_S);
  state.stridePhase += ((input.dt * input.speed) / stride) * Math.PI * 2;
  state.seconds += input.dt;
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
  rig.add(holder, rightArm.group, leftArm.group);
  const object = new Group();
  object.name = "viewModel";
  object.add(rig);
  const parts: ViewParts = {
    rig,
    holder,
    right: rightArm.group,
    left: leftArm.group,
  };
  const state: ViewState = {
    weapon: null,
    model: null,
    lastFiredTick: null,
    kick: 0,
    swap: 0,
    stridePhase: 0,
    seconds: 0,
  };
  return {
    object,
    update(input) {
      syncWeapon(state, parts, input.weapon);
      syncShot(state, input);
      placeHands(parts, preparedLayout(input.weapon), state.kick);
      placeRig(rig, state, LAYOUTS[input.weapon], input.speed);
      advance(state, input);
    },
    dispose() {
      object.removeFromParent();
      rightArm.mesh.geometry.dispose();
      leftArm.mesh.geometry.dispose();
    },
  };
}
