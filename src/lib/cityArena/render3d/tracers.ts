/**
 * Bullet tracers: a thin additive line per round in flight, bright at the round and fading to
 * nothing behind it (spec §6.8). All tracers share one `LineSegments` draw call whose buffers are
 * sized once; the tail's colour is black, which additive blending turns into "no light", so the
 * fade needs no per-vertex alpha.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
} from "three";
import type { BulletState } from "../sim/types";
import { WEAPONS, type WeaponSpec } from "../sim/weapons";
import { PERSON_CHEST_HEIGHT_M } from "./coords";

/** Length of a tracer behind its round, metres (spec §6.8). */
export const TRACER_LENGTH_M = 3;
/** Rounds drawn at once; a burst beyond it goes without tracers for a frame. */
export const MAX_TRACERS = 128;
/** Hot yellow-white of the tracer at its round. */
const TRACER_HEAD_COLOUR = 0xffe9a8;
/** Floats per line vertex. */
const XYZ = 3;
/** Vertices per tracer: the round and the tail. */
const ENDS = 2;

/** The tracer lines, written from the rounds in flight each frame. */
export type Tracers = {
  /** Add to the scene once. */
  object: LineSegments;
  /** Starts a frame's tracers; follow with `add` per round and `commit`. */
  begin(): void;
  /** Draws a tracer behind a round. */
  add(bullet: BulletState): void;
  /** Uploads the frame's tracers. */
  commit(): void;
  /** Frees the geometry and material; detach `object` yourself. */
  dispose(): void;
};

/** How far a round has flown since it left the barrel, as far as the tracer is concerned. */
function flown(bullet: BulletState): number {
  const spec: WeaponSpec | undefined = WEAPONS[bullet.weapon];
  return spec ? spec.rangeM - bullet.rangeLeftM : TRACER_LENGTH_M;
}

function createGeometry(): BufferGeometry {
  const positions = new Float32Array(MAX_TRACERS * ENDS * XYZ);
  const colours = new Float32Array(MAX_TRACERS * ENDS * XYZ);
  const head = new Color(TRACER_HEAD_COLOUR);
  for (let tracer = 0; tracer < MAX_TRACERS; tracer++)
    head.toArray(colours, tracer * ENDS * XYZ);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, XYZ));
  geometry.setAttribute("color", new BufferAttribute(colours, XYZ));
  geometry.setDrawRange(0, 0);
  return geometry;
}

/**
 * Creates the tracer lines.
 *
 * @returns The tracers; each frame call `begin`, `add` for every gun round and `commit`.
 */
export function createTracers(): Tracers {
  const geometry = createGeometry();
  const material = new LineBasicMaterial({
    vertexColors: true,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.name = "tracers";
  lines.frustumCulled = false;
  const positions = geometry.getAttribute("position") as BufferAttribute;
  let count = 0;
  return {
    object: lines,
    begin() {
      count = 0;
    },
    add(bullet) {
      if (count >= MAX_TRACERS) return;
      const tail = Math.max(0, Math.min(TRACER_LENGTH_M, flown(bullet)));
      const at = count * ENDS;
      positions.setXYZ(at, bullet.x, PERSON_CHEST_HEIGHT_M, bullet.y);
      positions.setXYZ(
        at + 1,
        bullet.x - bullet.directionX * tail,
        PERSON_CHEST_HEIGHT_M,
        bullet.y - bullet.directionY * tail,
      );
      count += 1;
    },
    commit() {
      geometry.setDrawRange(0, count * ENDS);
      positions.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
