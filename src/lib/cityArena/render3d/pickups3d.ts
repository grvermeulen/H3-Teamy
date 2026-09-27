/**
 * Pickups floating over their spawn point: a weapon model (or a health box) that spins and bobs,
 * over an additive glow disc coloured like the 2D radar's pickup diamonds. Hidden once taken.
 */
import {
  AdditiveBlending,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type BufferGeometry,
  type Object3D,
} from "three";
import { pickupColour } from "../render/drawPickups";
import { SIM_STEP_S } from "../sim/player";
import type { PickupKind } from "../sim/types";
import { characterMaterials } from "./characterRig";
import { block, mergeParts, type Vec3 } from "./lowPoly";
import { createWeaponModel } from "./weapons3d";

/** Height the item floats at, metres. */
const FLOAT_HEIGHT_M = 1.0;
/** How fast the item spins, radians per second of sim time. */
const SPIN_RATE_RAD_PER_S = 1.2;
/** How far the item bobs above and below {@link FLOAT_HEIGHT_M}, metres. */
const BOB_AMPLITUDE_M = 0.08;
/** How fast the item bobs, radians per second; not pinned by spec, chosen for a lively float. */
const BOB_RATE_RAD_PER_S = 2.4;

/** Radius of the ground glow disc, metres. */
const GLOW_RADIUS_M = 0.5;
/** Facets around the glow disc's rim. */
const GLOW_SEGMENTS = 20;
/** Height of the glow disc above the ground, metres: just proud of it, to avoid z-fighting. */
const GLOW_HEIGHT_M = 0.02;
/** Opacity of the additive glow. */
const GLOW_OPACITY = 0.55;

/** Edge length of the health pickup's box, metres. */
const HEALTH_BOX_M = 0.22;
/** Half of {@link HEALTH_BOX_M}. */
const HEALTH_HALF_M = HEALTH_BOX_M / 2;
/** Bevel on the health box's edges. */
const HEALTH_CHAMFER = 0.15;
/** White of the health box. */
const HEALTH_WHITE = 0xf2f2f2;
/** Red of the health cross. */
const HEALTH_RED = 0xdc2626;
/** Length of one arm of the health cross, metres. */
const CROSS_ARM_LENGTH_M = 0.16;
/** Width and thickness of one arm of the health cross, metres. */
const CROSS_ARM_WIDTH_M = 0.045;
/** How far a cross arm sits proud of the box's face, metres: avoids z-fighting. */
const CROSS_DEPTH_M = 0.012;

/** A pickup floating over its spawn point. */
export type Pickup3d = {
  /** Add to the scene at the pickup's spawn point. */
  object: Object3D;
  update(input: { taken: boolean; tick: number }): void;
  /** Detaches the pickup; its geometry and materials are shared and outlive it. */
  dispose(): void;
};

let glowDiscGeometry: BufferGeometry | null = null;

/** The shared, flat glow disc geometry, lying in the ground plane and facing up. */
function glowGeometry(): BufferGeometry {
  if (!glowDiscGeometry) {
    glowDiscGeometry = new CircleGeometry(GLOW_RADIUS_M, GLOW_SEGMENTS);
    glowDiscGeometry.rotateX(-Math.PI / 2);
  }
  return glowDiscGeometry;
}

const glowMaterials = new Map<string, MeshBasicMaterial>();

/** The additive glow material for a colour, built once per colour and shared. */
function glowMaterial(colour: string): MeshBasicMaterial {
  const cached = glowMaterials.get(colour);
  if (cached) return cached;
  const material = new MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity: GLOW_OPACITY,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  glowMaterials.set(colour, material);
  return material;
}

/** The pickup's ground glow: a flat additive disc just above the ground, in its 2D colour. */
function createGlow(kind: PickupKind): Mesh {
  const mesh = new Mesh(glowGeometry(), glowMaterial(pickupColour(kind)));
  mesh.name = "pickupGlow";
  mesh.position.y = GLOW_HEIGHT_M;
  return mesh;
}

let healthBoxGeometry: BufferGeometry | null = null;

/** The health pickup's white box, built once and shared. */
function healthBox(): BufferGeometry {
  if (!healthBoxGeometry) {
    healthBoxGeometry = block({
      size: [HEALTH_BOX_M, HEALTH_BOX_M, HEALTH_BOX_M],
      at: [0, 0, 0],
      colour: HEALTH_WHITE,
      chamfer: HEALTH_CHAMFER,
    });
  }
  return healthBoxGeometry;
}

/** The box's four side faces a cross is drawn on: front/back (x) and left/right (z). */
const CROSS_FACES: ReadonlyArray<{ axis: 0 | 2; sign: 1 | -1 }> = [
  { axis: 0, sign: 1 },
  { axis: 0, sign: -1 },
  { axis: 2, sign: 1 },
  { axis: 2, sign: -1 },
];

/** The two thin red boxes forming a `+` on one side face of the health box. */
function crossOnFace(axis: 0 | 2, sign: 1 | -1): BufferGeometry[] {
  const out = HEALTH_HALF_M + CROSS_DEPTH_M / 2;
  const at: Vec3 = axis === 0 ? [sign * out, 0, 0] : [0, 0, sign * out];
  const along: Vec3 =
    axis === 0
      ? [CROSS_DEPTH_M, CROSS_ARM_LENGTH_M, CROSS_ARM_WIDTH_M]
      : [CROSS_ARM_WIDTH_M, CROSS_ARM_LENGTH_M, CROSS_DEPTH_M];
  const across: Vec3 =
    axis === 0
      ? [CROSS_DEPTH_M, CROSS_ARM_WIDTH_M, CROSS_ARM_LENGTH_M]
      : [CROSS_ARM_LENGTH_M, CROSS_ARM_WIDTH_M, CROSS_DEPTH_M];
  return [
    block({ size: along, at, colour: HEALTH_RED }),
    block({ size: across, at, colour: HEALTH_RED }),
  ];
}

let healthCrossGeometry: BufferGeometry | null = null;

/** The red crosses on all four side faces, merged once and shared. */
function healthCross(): BufferGeometry {
  if (!healthCrossGeometry) {
    const parts = CROSS_FACES.flatMap(({ axis, sign }) =>
      crossOnFace(axis, sign),
    );
    healthCrossGeometry = mergeParts(parts);
  }
  return healthCrossGeometry;
}

/**
 * Frees the glow disc, the glow materials and the health box and cross every pickup shares, and
 * forgets them, so a view that has gone keeps none (nor its renderer) reachable; the next view
 * builds them afresh on first use.
 */
export function disposePickupAssets(): void {
  glowDiscGeometry?.dispose();
  glowDiscGeometry = null;
  for (const material of glowMaterials.values()) material.dispose();
  glowMaterials.clear();
  healthBoxGeometry?.dispose();
  healthBoxGeometry = null;
  healthCrossGeometry?.dispose();
  healthCrossGeometry = null;
}

/** The health pickup's model: a white box with a red cross on each side face. */
function createHealthModel(): Object3D {
  const group = new Group();
  group.name = "health";
  const material = characterMaterials().body;
  const box = new Mesh(healthBox(), material);
  box.name = "healthBox";
  const cross = new Mesh(healthCross(), material);
  cross.name = "cross";
  group.add(box, cross);
  return group;
}

/** The item a pickup shows: the health box, or the matching weapon's model. */
function itemModel(kind: PickupKind): Object3D {
  return kind === "health" ? createHealthModel() : createWeaponModel(kind);
}

/**
 * A pickup for a spawn point: its item spins and bobs above an additive glow disc, hidden while
 * taken. The rocket pickup shows the rocket launcher's model.
 *
 * @param kind - The pickup's kind.
 * @returns A pickup; call `update` every sim tick and `dispose` when it is removed from the scene.
 */
export function createPickup3d(kind: PickupKind): Pickup3d {
  const object = new Group();
  object.name = `pickup:${kind}`;
  const item = new Group();
  item.name = "pickupItem";
  item.position.y = FLOAT_HEIGHT_M;
  item.add(itemModel(kind));
  object.add(createGlow(kind), item);

  return {
    object,
    update({ taken, tick }) {
      object.visible = !taken;
      const seconds = tick * SIM_STEP_S;
      item.rotation.y = seconds * SPIN_RATE_RAD_PER_S;
      item.position.y =
        FLOAT_HEIGHT_M +
        BOB_AMPLITUDE_M * Math.sin(seconds * BOB_RATE_RAD_PER_S);
    },
    dispose() {
      object.removeFromParent();
    },
  };
}
