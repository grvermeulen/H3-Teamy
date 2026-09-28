/**
 * Bullet tracers: a thin additive line per round in flight, bright at the round and fading to
 * nothing behind it (spec §6.8). All tracers share one `LineSegments` draw call whose buffers are
 * sized once; the tail's colour is black, which additive blending turns into "no light", so the
 * fade needs no per-vertex alpha. A round whose shooter's muzzle is known is drawn out of that
 * muzzle, converging onto its flat line — or, the local shooter's, onto the height of what their
 * crosshair covered (`muzzleBlend.ts`).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  Vector3,
} from "three";
import type { BulletState } from "../sim/types";
import { blendedRoundPoint, roundFlownM, type RoundAim } from "./muzzleBlend";

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
  /**
   * Draws a tracer behind a round.
   *
   * @param bullet - The round in flight.
   * @param muzzle - Its shooter's muzzle, three.js space; `null` draws it on its flat line.
   * @param aim - What the local shooter aimed it at; `null` for everyone else's rounds.
   */
  add(
    bullet: BulletState,
    muzzle?: Readonly<Vector3> | null,
    aim?: RoundAim | null,
  ): void;
  /** Uploads the frame's tracers. */
  commit(): void;
  /** Frees the geometry and material; detach `object` yourself. */
  dispose(): void;
};

/**
 * Length of a round's tracer: how far it has flown, capped at {@link TRACER_LENGTH_M}, so a round
 * just out of the barrel does not trail a line back through its shooter.
 *
 * @param bullet - The round in flight.
 * @returns The tail length behind the round, metres, in `[0, TRACER_LENGTH_M]`.
 */
export function tracerTail(
  bullet: Pick<BulletState, "weapon" | "rangeLeftM">,
): number {
  return Math.min(TRACER_LENGTH_M, roundFlownM(bullet));
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
  const head = new Vector3();
  const tail = new Vector3();
  let count = 0;
  return {
    object: lines,
    begin() {
      count = 0;
    },
    add(bullet, muzzle = null, aim = null) {
      if (count >= MAX_TRACERS) return;
      const flown = roundFlownM(bullet);
      blendedRoundPoint(bullet, flown, muzzle, head, 0, aim);
      blendedRoundPoint(bullet, flown, muzzle, tail, TRACER_LENGTH_M, aim);
      const at = count * ENDS;
      positions.setXYZ(at, head.x, head.y, head.z);
      positions.setXYZ(at + 1, tail.x, tail.y, tail.z);
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
