/**
 * A vehicle's lamps as lights, not just coloured boxes: every head and tail lamp the kit glows is
 * recorded, the tail lamps burn a dim running red that brightens while braking, and each lamp
 * throws a soft additive flare (one `Points` draw per vehicle) that only shows from in front of
 * the lamp it belongs to.
 */
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Points,
  type Material,
  type Mesh,
} from "three";
import { flareMaterial, glowMaterial } from "./vehicleParts";
import { HEADLIGHT, TAIL_LIGHT } from "./vehicleShapes";

/** The tail lamps' dim running glow; braking lights them in {@link TAIL_LIGHT}. */
export const TAIL_RUNNING = 0x5c140f;
/** How far in front of its lamp's face a flare sits, metres, so the body never cuts into it. */
const FLARE_PROUD_M = 0.06;
/** Each flare's strength: headlights, tail lamps running, and tail lamps braking. */
const FLARE_STRENGTH = { head: 0.75, running: 0.2, braking: 1 };

/** A lamp: its middle in the vehicle's frame, which end it faces, and whether it is a tail lamp. */
export type Lamp = {
  at: readonly [number, number, number];
  facing: 1 | -1;
  tail: boolean;
};

/**
 * A lamp whose face is known: its flare sits just in front of it.
 *
 * @param face - The middle of the lamp's face, in the vehicle's frame.
 * @param facing - The end it faces: forward (1) or backward (−1).
 * @param tail - Whether it is a tail lamp.
 * @returns The lamp.
 */
export function lampAt(
  face: readonly [number, number, number],
  facing: 1 | -1,
  tail: boolean,
): Lamp {
  return {
    at: [face[0] + facing * FLARE_PROUD_M, face[1], face[2]],
    facing,
    tail,
  };
}

/**
 * The lamp a glowing part makes, when it is a head or tail lamp.
 *
 * @param geometry - The part, in the vehicle's frame.
 * @param hex - Its glow colour.
 * @returns The lamp, or null for other glowing parts (sign boards).
 */
export function lampOf(geometry: BufferGeometry, hex: number): Lamp | null {
  if (hex !== HEADLIGHT && hex !== TAIL_LIGHT) return null;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const facing = box.max.x + box.min.x >= 0 ? 1 : -1;
  const face = facing > 0 ? box.max.x : box.min.x;
  return {
    at: [
      face + facing * FLARE_PROUD_M,
      (box.min.y + box.max.y) / 2,
      (box.min.z + box.max.z) / 2,
    ],
    facing,
    tail: hex === TAIL_LIGHT,
  };
}

/**
 * The material a glowing part is drawn with: tail lamps start on their dim running glow.
 *
 * @param hex - The part's glow colour.
 * @returns The shared emissive material.
 */
export function lampMaterial(hex: number): Material {
  return glowMaterial(hex === TAIL_LIGHT ? TAIL_RUNNING : hex);
}

/** A vehicle's lamps: the body's tail-lamp material slot and the flares. */
export type LampRig = {
  body: Mesh;
  /** Index of the tail lamps' material in the body's material array, or −1 without tail lamps. */
  tailSlot: number;
  flares: Points | null;
  lamps: readonly Lamp[];
};

/** Writes each flare's colour: warm white ahead, red behind, brighter while braking. */
function paintFlares(rig: LampRig, braking: boolean): void {
  const colours = rig.flares?.geometry.getAttribute("color");
  if (!colours) return;
  const head = new Color(HEADLIGHT).multiplyScalar(FLARE_STRENGTH.head);
  const tailStrength = braking
    ? FLARE_STRENGTH.braking
    : FLARE_STRENGTH.running;
  const tail = new Color(TAIL_LIGHT).multiplyScalar(tailStrength);
  rig.lamps.forEach((lamp, index) => {
    const colour = lamp.tail ? tail : head;
    colours.setXYZ(index, colour.r, colour.g, colour.b);
  });
  colours.needsUpdate = true;
}

/** One point per lamp, facing out of its end of the vehicle. */
function flaresOf(lamps: readonly Lamp[]): Points | null {
  if (lamps.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      lamps.flatMap((lamp) => [...lamp.at]),
      3,
    ),
  );
  geometry.setAttribute(
    "normal",
    new Float32BufferAttribute(
      lamps.flatMap((lamp) => [lamp.facing, 0, 0]),
      3,
    ),
  );
  geometry.setAttribute(
    "color",
    new Float32BufferAttribute(new Float32Array(lamps.length * 3), 3),
  );
  const points = new Points(geometry, flareMaterial());
  points.name = "lamp-flares";
  return points;
}

/**
 * Rigs a built body's lamps: finds the tail lamps' material slot and adds the flares beside it.
 *
 * @param body - The merged body mesh, one material per draw group.
 * @param lamps - Every lamp the kit glowed.
 * @returns The rig; add `flares` to the vehicle's root.
 */
export function rigLamps(body: Mesh, lamps: readonly Lamp[]): LampRig {
  const materials = Array.isArray(body.material)
    ? body.material
    : [body.material];
  const rig: LampRig = {
    body,
    tailSlot: materials.indexOf(glowMaterial(TAIL_RUNNING)),
    flares: flaresOf(lamps),
    lamps,
  };
  paintFlares(rig, false);
  return rig;
}

/**
 * Lights the tail lamps for braking or dims them back to running.
 *
 * @param rig - The vehicle's lamps.
 * @param braking - Whether the vehicle is braking.
 */
export function showBraking(rig: LampRig, braking: boolean): void {
  const materials = rig.body.material;
  if (rig.tailSlot >= 0 && Array.isArray(materials))
    materials[rig.tailSlot] = glowMaterial(braking ? TAIL_LIGHT : TAIL_RUNNING);
  paintFlares(rig, braking);
}

/**
 * Shows or hides the flares: a wreck's lamps are dark.
 *
 * @param rig - The vehicle's lamps.
 * @param lit - Whether the lamps burn.
 */
export function showFlares(rig: LampRig, lit: boolean): void {
  if (rig.flares) rig.flares.visible = lit;
}
