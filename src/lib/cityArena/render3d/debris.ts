/**
 * Tumbling debris chunks thrown by explosions and collapses: low-poly rocks in one instanced draw
 * call. Like the particles, the living chunks stay packed at the front of the pool, so the instance
 * count is the living count and `update` allocates nothing.
 */
import {
  Color,
  DodecahedronGeometry,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three";

/** Downward acceleration of a chunk, m/s² (spec §6.8). */
export const DEBRIS_GRAVITY = 9.8;
/** Vertical speed a chunk keeps when it bounces. */
const DEBRIS_BOUNCE = 0.35;
/** Below this bounce speed a chunk stops bouncing, m/s. */
const DEBRIS_REST_SPEED_MPS = 1;
/** Horizontal speed a chunk keeps each time it touches the ground. */
const DEBRIS_GROUND_FRICTION = 0.55;
/** Tumble a chunk keeps each time it touches the ground. */
const DEBRIS_GROUND_SPIN = 0.5;
/** A resting chunk's centre sits this share of its size above the ground. */
const DEBRIS_REST_HEIGHT_SHARE = 0.4;
/** The last seconds of a chunk's life, over which it shrinks away. */
const DEBRIS_FADE_S = 0.4;
/** How the tumble rate splits over the three axes, so chunks do not all roll the same way. */
const SPIN_AXES = [1, 0.6, 0.3] as const;
/** Radians of start pose per metre of spawn position, so a burst's chunks lie every which way. */
const POSE_SCATTER_RAD_PER_M = 1.7;
/** Radius of the unit chunk: a size-metre chunk is this rock scaled by its size. */
const UNIT_CHUNK_RADIUS = 0.5;

/** A chunk to throw, in three.js space (y up), metres and seconds. */
export type DebrisSpawn = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Width of the chunk, metres. */
  size: number;
  /** sRGB hex colour. */
  colour: number;
  /** Tumble rate in flight, radians per second. */
  spin: number;
  /** Seconds before it has shrunk away. */
  maxLife: number;
};

/** A pool of debris chunks drawn as one `InstancedMesh`. */
export type DebrisPool = {
  /** Add to the scene once; it draws every living chunk. */
  object: InstancedMesh;
  /** Throws a chunk; dropped when the pool is full. */
  spawn(chunk: DebrisSpawn): void;
  /** Moves, bounces, tumbles and expires every chunk. Allocates nothing. */
  update(dt: number): void;
  /** How many chunks are alive. */
  alive(): number;
  /** Frees the geometry, material and instance buffers; detach `object` yourself. */
  dispose(): void;
};

type Pool = {
  position: Float32Array;
  velocity: Float32Array;
  rotation: Float32Array;
  colour: Float32Array;
  spin: Float32Array;
  size: Float32Array;
  age: Float32Array;
  maxLife: Float32Array;
};

function createPool(capacity: number): Pool {
  return {
    position: new Float32Array(capacity * 3),
    velocity: new Float32Array(capacity * 3),
    rotation: new Float32Array(capacity * 3),
    colour: new Float32Array(capacity * 3),
    spin: new Float32Array(capacity),
    size: new Float32Array(capacity),
    age: new Float32Array(capacity),
    maxLife: new Float32Array(capacity),
  };
}

const scratchColour = new Color();

function write(pool: Pool, index: number, chunk: DebrisSpawn): void {
  const at = index * 3;
  pool.position[at] = chunk.x;
  pool.position[at + 1] = chunk.y;
  pool.position[at + 2] = chunk.z;
  pool.velocity[at] = chunk.vx;
  pool.velocity[at + 1] = chunk.vy;
  pool.velocity[at + 2] = chunk.vz;
  pool.rotation[at] = (chunk.x + chunk.z) * POSE_SCATTER_RAD_PER_M;
  pool.rotation[at + 1] = chunk.y * POSE_SCATTER_RAD_PER_M;
  pool.rotation[at + 2] = (chunk.z - chunk.x) * POSE_SCATTER_RAD_PER_M;
  scratchColour.setHex(chunk.colour);
  scratchColour.toArray(pool.colour, at);
  pool.spin[index] = chunk.spin;
  pool.size[index] = chunk.size;
  pool.age[index] = 0;
  pool.maxLife[index] = chunk.maxLife;
}

function move(pool: Pool, from: number, to: number): void {
  const source = from * 3;
  pool.position.copyWithin(to * 3, source, source + 3);
  pool.velocity.copyWithin(to * 3, source, source + 3);
  pool.rotation.copyWithin(to * 3, source, source + 3);
  pool.colour.copyWithin(to * 3, source, source + 3);
  pool.spin[to] = pool.spin[from];
  pool.size[to] = pool.size[from];
  pool.age[to] = pool.age[from];
  pool.maxLife[to] = pool.maxLife[from];
}

/** Bounces a chunk off the ground, bleeding speed and tumble until it lies still. */
function bounce(pool: Pool, index: number): void {
  const at = index * 3;
  const rest = pool.size[index] * DEBRIS_REST_HEIGHT_SHARE;
  if (pool.position[at + 1] >= rest) return;
  pool.position[at + 1] = rest;
  const up = Math.abs(pool.velocity[at + 1]) * DEBRIS_BOUNCE;
  pool.velocity[at + 1] = up < DEBRIS_REST_SPEED_MPS ? 0 : up;
  pool.velocity[at] *= DEBRIS_GROUND_FRICTION;
  pool.velocity[at + 2] *= DEBRIS_GROUND_FRICTION;
  pool.spin[index] *= DEBRIS_GROUND_SPIN;
}

/** Ages, moves and tumbles one chunk; false once it has lived out its life. */
function step(pool: Pool, index: number, dt: number): boolean {
  const age = pool.age[index] + dt;
  if (age >= pool.maxLife[index]) return false;
  pool.age[index] = age;
  const at = index * 3;
  pool.velocity[at + 1] -= DEBRIS_GRAVITY * dt;
  for (let axis = 0; axis < 3; axis++) {
    pool.position[at + axis] += pool.velocity[at + axis] * dt;
    pool.rotation[at + axis] += pool.spin[index] * SPIN_AXES[axis] * dt;
  }
  bounce(pool, index);
  return true;
}

const scratchPosition = new Vector3();
const scratchScale = new Vector3();
const scratchEuler = new Euler();
const scratchQuaternion = new Quaternion();
const scratchMatrix = new Matrix4();

/** Writes one chunk's pose into the instance matrix, shrinking it over its last moments. */
function place(mesh: InstancedMesh, pool: Pool, index: number): void {
  const at = index * 3;
  const left = pool.maxLife[index] - pool.age[index];
  const scale = pool.size[index] * Math.min(1, left / DEBRIS_FADE_S);
  scratchPosition.fromArray(pool.position, at);
  scratchEuler.set(
    pool.rotation[at],
    pool.rotation[at + 1],
    pool.rotation[at + 2],
  );
  scratchQuaternion.setFromEuler(scratchEuler);
  scratchScale.setScalar(scale);
  scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
  mesh.setMatrixAt(index, scratchMatrix);
}

function createMesh(
  capacity: number,
  pool: Pool,
  material: MeshLambertMaterial,
): InstancedMesh {
  const geometry = new DodecahedronGeometry(UNIT_CHUNK_RADIUS, 0);
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceColor = new InstancedBufferAttribute(pool.colour, 3);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Creates a pool of debris chunks drawn in one call.
 *
 * @param capacity - Most chunks alive at once; every buffer is sized to it up front.
 * @returns The pool; add `object` to the scene and call `update` once per frame.
 */
export function createDebrisPool(capacity: number): DebrisPool {
  const pool = createPool(capacity);
  const material = new MeshLambertMaterial({ flatShading: true });
  const mesh = createMesh(capacity, pool, material);
  let count = 0;
  return {
    object: mesh,
    spawn(chunk) {
      if (count >= capacity) return;
      write(pool, count, chunk);
      count += 1;
    },
    update(dt) {
      for (let index = count - 1; index >= 0; index--) {
        if (step(pool, index, dt)) continue;
        count -= 1;
        if (index !== count) move(pool, count, index);
      }
      for (let index = 0; index < count; index++) place(mesh, pool, index);
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    alive: () => count,
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
