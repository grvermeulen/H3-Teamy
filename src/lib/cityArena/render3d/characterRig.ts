/**
 * The one procedural rig every 3D character shares: 17 bones, and one merged geometry per look
 * whose vertices each follow a single bone (rigid skinning), so a character is one skinned mesh.
 *
 * The character faces local +X, stands on y = 0 with +Y up, and its right hand side is +Z (so
 * {@link headingToRotationY} from `coords.ts` turns it to face a world heading).
 */
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Skeleton,
  SkinnedMesh,
  Sphere,
  Uint16BufferAttribute,
  Vector3,
  MathUtils,
} from "three";
import {
  bodyParts,
  DELTOID_SCALE,
  type PartContext,
  type RigPart,
} from "./characterParts";
import { extraParts } from "./characterExtras";
import {
  DEFAULT_VEST_HUE,
  vestColour,
  type Build,
  type LookSpec,
} from "./characterLooks";
import { mergeParts, type Vec3 } from "./lowPoly";

/** The rig's bones, parents before children. */
export const BONES = [
  "pelvis",
  "spine",
  "chest",
  "neck",
  "head",
  "upperArmL",
  "lowerArmL",
  "handL",
  "upperArmR",
  "lowerArmR",
  "handR",
  "upperLegL",
  "lowerLegL",
  "footL",
  "upperLegR",
  "lowerLegR",
  "footR",
] as const;

/** One bone of the rig. */
export type BoneName = (typeof BONES)[number];

/** Each bone's parent; the pelvis is the root. */
export const BONE_PARENTS: Record<BoneName, BoneName | null> = {
  pelvis: null,
  spine: "pelvis",
  chest: "spine",
  neck: "chest",
  head: "neck",
  upperArmL: "chest",
  lowerArmL: "upperArmL",
  handL: "lowerArmL",
  upperArmR: "chest",
  lowerArmR: "upperArmR",
  handR: "lowerArmR",
  upperLegL: "pelvis",
  lowerLegL: "upperLegL",
  footL: "lowerLegL",
  upperLegR: "pelvis",
  lowerLegR: "upperLegR",
  footR: "lowerLegR",
};

/** Height of the pelvis bone above the ground when standing, metres; the same for every look. */
export const PELVIS_HEIGHT_M = 0.95;
/** Chin to crown, metres. */
const HEAD_HEIGHT_M = 0.24;
/** Chin down to the base of the neck, metres. */
const NECK_LENGTH_M = 0.08;
/** The shoulder joints sit this far below the base of the neck, metres. */
const SHOULDER_DROP_M = 0.03;
/** Spine bone above the pelvis bone, metres. */
const SPINE_RISE_M = 0.1;
/** Where the chest bone sits between the pelvis and the shoulders, 0…1. */
const CHEST_SHARE = 0.5;
/** Shoulder to elbow, metres. */
const UPPER_ARM_M = 0.29;
/** Elbow to wrist, metres. */
const LOWER_ARM_M = 0.26;
/** Hip joints, metres above the ground. */
const HIP_JOINT_M = 0.9;
/** Knees, metres above the ground. */
const KNEE_M = 0.5;
/** Ankles, metres above the ground. */
const ANKLE_M = 0.085;

/** Body measurements of a build, metres. Widths run along z, depths along x. */
export type Proportions = {
  height: number;
  shoulderWidth: number;
  chestWidth: number;
  chestDepth: number;
  waistWidth: number;
  waistDepth: number;
  hipWidth: number;
  /** Upper arm thickness. */
  arm: number;
  forearm: number;
  hand: number;
  thigh: number;
  calf: number;
  neck: number;
  /** Distance of each hip joint from the midline. */
  hipSpacing: number;
  headWidth: number;
  headDepth: number;
};

/** Measurements of each build, all but the height. */
const BUILD_SHAPES: Record<Build, Omit<Proportions, "height">> = {
  broad: {
    shoulderWidth: 0.56,
    chestWidth: 0.4,
    chestDepth: 0.27,
    waistWidth: 0.34,
    waistDepth: 0.24,
    hipWidth: 0.38,
    arm: 0.14,
    forearm: 0.12,
    hand: 0.11,
    thigh: 0.18,
    calf: 0.14,
    neck: 0.15,
    hipSpacing: 0.1,
    headWidth: 0.2,
    headDepth: 0.22,
  },
  average: {
    shoulderWidth: 0.44,
    chestWidth: 0.32,
    chestDepth: 0.21,
    waistWidth: 0.28,
    waistDepth: 0.19,
    hipWidth: 0.32,
    arm: 0.105,
    forearm: 0.092,
    hand: 0.095,
    thigh: 0.15,
    calf: 0.118,
    neck: 0.11,
    hipSpacing: 0.085,
    headWidth: 0.185,
    headDepth: 0.21,
  },
  slim: {
    shoulderWidth: 0.38,
    chestWidth: 0.27,
    chestDepth: 0.18,
    waistWidth: 0.22,
    waistDepth: 0.16,
    hipWidth: 0.29,
    arm: 0.088,
    forearm: 0.078,
    hand: 0.085,
    thigh: 0.135,
    calf: 0.105,
    neck: 0.095,
    hipSpacing: 0.078,
    headWidth: 0.175,
    headDepth: 0.2,
  },
};

/**
 * The measurements of a look's body.
 *
 * @param look - The look.
 * @returns Its build's measurements at its height.
 */
export function proportionsOf(look: LookSpec): Proportions {
  return { ...BUILD_SHAPES[look.build], height: look.height };
}

/** Bind-pose position of each bone's joint, in the character's space. */
export type Joints = Record<BoneName, Vec3>;

/** Joints down one arm or leg, all at the same `z`, top to bottom. */
function limbJoints(
  names: readonly [BoneName, BoneName, BoneName],
  z: number,
  heights: readonly [number, number, number],
): Partial<Joints> {
  return Object.fromEntries(
    names.map((name, index): [BoneName, Vec3] => [
      name,
      [0, heights[index], z],
    ]),
  );
}

/**
 * Where each joint sits in the bind pose. Legs are the same length for every look; a taller look
 * gets a longer torso, so poses can share one pelvis height.
 *
 * @param p - The body's measurements.
 * @returns Each bone's joint position.
 */
export function jointsOf(p: Proportions): Joints {
  const headBase = p.height - HEAD_HEIGHT_M;
  const neckBase = headBase - NECK_LENGTH_M;
  const shoulder = neckBase - SHOULDER_DROP_M;
  const shoulderZ = p.shoulderWidth / 2 - (DELTOID_SCALE * p.arm) / 2;
  const elbow = shoulder - UPPER_ARM_M;
  const armHeights: [number, number, number] = [
    shoulder,
    elbow,
    elbow - LOWER_ARM_M,
  ];
  const legHeights: [number, number, number] = [HIP_JOINT_M, KNEE_M, ANKLE_M];
  return {
    pelvis: [0, PELVIS_HEIGHT_M, 0],
    spine: [0, PELVIS_HEIGHT_M + SPINE_RISE_M, 0],
    chest: [0, PELVIS_HEIGHT_M + (shoulder - PELVIS_HEIGHT_M) * CHEST_SHARE, 0],
    neck: [0, neckBase, 0],
    head: [0, headBase, 0],
    ...limbJoints(["upperArmL", "lowerArmL", "handL"], -shoulderZ, armHeights),
    ...limbJoints(["upperArmR", "lowerArmR", "handR"], shoulderZ, armHeights),
    ...limbJoints(
      ["upperLegL", "lowerLegL", "footL"],
      -p.hipSpacing,
      legHeights,
    ),
    ...limbJoints(
      ["upperLegR", "lowerLegR", "footR"],
      p.hipSpacing,
      legHeights,
    ),
  } as Joints;
}

/** The materials every character shares. */
export type CharacterMaterials = {
  /** Lit by the scene; colour comes from the vertices. */
  body: MeshLambertMaterial;
  /** Unlit, for parts that glow (the player's lenses). */
  glow: MeshBasicMaterial;
  /** `[body, glow]`, the material array every character mesh uses. */
  list: [MeshLambertMaterial, MeshBasicMaterial];
};

let sharedMaterials: CharacterMaterials | null = null;

/**
 * The shared character materials, created on first use.
 *
 * @returns The same materials on every call.
 */
export function characterMaterials(): CharacterMaterials {
  if (!sharedMaterials) {
    const body = new MeshLambertMaterial({ vertexColors: true });
    const glow = new MeshBasicMaterial({ vertexColors: true });
    sharedMaterials = { body, glow, list: [body, glow] };
  }
  return sharedMaterials;
}

/** Binds every vertex of a part rigidly to its bone. */
function skinPart(part: RigPart): BufferGeometry {
  const count = part.geometry.getAttribute("position").count;
  const boneIndex = BONES.indexOf(part.bone);
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let vertex = 0; vertex < count; vertex += 1) {
    indices[vertex * 4] = boneIndex;
    weights[vertex * 4] = 1;
  }
  part.geometry.setAttribute(
    "skinIndex",
    new Uint16BufferAttribute(indices, 4),
  );
  part.geometry.setAttribute(
    "skinWeight",
    new Float32BufferAttribute(weights, 4),
  );
  return part.geometry;
}

/** Merges parts into one skinned geometry: body parts in group 0, glowing parts in group 1. */
function assemble(parts: RigPart[]): BufferGeometry {
  const lit = parts.filter((part) => !part.glow);
  const glowing = parts.filter((part) => part.glow);
  const litCount = lit.reduce(
    (sum, part) => sum + part.geometry.getAttribute("position").count,
    0,
  );
  const geometry = mergeParts([...lit, ...glowing].map(skinPart));
  const total = geometry.getAttribute("position").count;
  geometry.addGroup(0, litCount, 0);
  if (total > litCount) geometry.addGroup(litCount, total - litCount, 1);
  return geometry;
}

/** Hue steps in one turn when caching vest variants. */
const VEST_HUE_STEPS = 360;

const geometryCache = new WeakMap<LookSpec, Map<number, BufferGeometry>>();

/** The look's vest hue snapped to a cacheable step, or `null` if it wears no vest. */
function vestHueKey(
  look: LookSpec,
  vestHue: number | undefined,
): number | null {
  if (!look.extras.some((extra) => extra.kind === "vest")) return null;
  const turns = MathUtils.euclideanModulo(vestHue ?? DEFAULT_VEST_HUE, 1);
  return Math.round(turns * VEST_HUE_STEPS) % VEST_HUE_STEPS;
}

/** The merged geometry of a look, built once per look and vest hue. */
function characterGeometry(
  look: LookSpec,
  vestHue: number | undefined,
): BufferGeometry {
  const hueKey = vestHueKey(look, vestHue);
  const byHue = geometryCache.get(look) ?? new Map<number, BufferGeometry>();
  geometryCache.set(look, byHue);
  const key = hueKey ?? -1;
  const cached = byHue.get(key);
  if (cached) return cached;
  const p = proportionsOf(look);
  const context: PartContext = {
    look,
    p,
    joints: jointsOf(p),
    vest: hueKey === null ? null : vestColour(hueKey / VEST_HUE_STEPS),
  };
  const geometry = assemble([...bodyParts(context), ...extraParts(context)]);
  byHue.set(key, geometry);
  return geometry;
}

/** A fresh bone hierarchy at the joints; returns the bones in {@link BONES} order. */
function createBones(joints: Joints): Bone[] {
  const bones = BONES.map((name) => {
    const bone = new Bone();
    bone.name = name;
    return bone;
  });
  BONES.forEach((name, index) => {
    const parent = BONE_PARENTS[name];
    const at = new Vector3(...joints[name]);
    if (parent !== null) {
      at.sub(new Vector3(...joints[parent]));
      bones[BONES.indexOf(parent)].add(bones[index]);
    }
    bones[index].position.copy(at);
  });
  return bones;
}

/** Centre height of the culling sphere, metres. */
const CULL_CENTRE_Y_M = 0.9;
/** Radius of the culling sphere: covers any pose, standing or lying, metres. */
const CULL_RADIUS_M = 1.4;

/**
 * One merged, rigidly skinned geometry for a look (cached per look + vest hue) and a fresh
 * skeleton. The geometry and materials are shared: dispose only the skeleton when done.
 *
 * @param look - What the character wears.
 * @param vestHue - Vest hue in turns, for looks that wear a vest; ignored otherwise.
 * @returns A skinned mesh in its bind pose, the pelvis bone as its child.
 */
export function buildCharacterMesh(
  look: LookSpec,
  vestHue?: number,
): SkinnedMesh {
  const joints = jointsOf(proportionsOf(look));
  const mesh = new SkinnedMesh(
    characterGeometry(look, vestHue),
    characterMaterials().list,
  );
  const bones = createBones(joints);
  mesh.add(bones[0]);
  mesh.bind(new Skeleton(bones));
  mesh.boundingSphere = new Sphere(
    new Vector3(0, CULL_CENTRE_Y_M, 0),
    CULL_RADIUS_M,
  );
  return mesh;
}
