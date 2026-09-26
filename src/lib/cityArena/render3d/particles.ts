/**
 * Pooled 3D particles: one `Points` draw call per blend mode (spec §6.8, §8). Every buffer is
 * allocated once at `capacity`; living particles stay packed at the front of the buffers (a dead
 * one is replaced by the last living one), so the draw range is just the living count and `update`
 * allocates nothing.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  Vector4,
  type ShaderMaterial,
} from "three";
import { createParticleMaterial } from "./particleMaterial";

/** Velocity a particle keeps when it bounces off the ground. */
const GROUND_BOUNCE = 0.3;
/** Horizontal velocity a particle keeps when it touches the ground. */
const GROUND_FRICTION = 0.6;

/** One particle in three.js space (y up), metres and seconds. */
export type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds lived so far; it dies at `maxLife`. */
  life: number;
  /** Seconds it lives. */
  maxLife: number;
  /** Diameter at birth, metres; fire shrinks from it, smoke billows out of it. */
  size: number;
  /** sRGB hex colour. */
  colour: number;
  /** Downward acceleration, m/s²; negative lifts it like warm smoke. */
  gravity: number;
  /** Rate at which it loses speed: velocity × e^(−drag·dt) each step. */
  drag: number;
};

/** A pool of particles drawn as one `Points` object. */
export type ParticleSystem = {
  /** Add to the scene once; it draws every living particle. */
  object: Points;
  /** Most particles alive at once; spawns beyond it are dropped. */
  capacity: number;
  /** Starts a particle at life 0; dropped when the pool is full. */
  spawn(p: Omit<Particle, "life">): void;
  /** Ages, moves and expires every particle, and uploads the buffers. Allocates nothing. */
  update(dt: number): void;
  /** How many particles are alive. */
  alive(): number;
  /** Frees the geometry and the material; detach `object` yourself. */
  dispose(): void;
};

/** The pool's buffers; index `i` of each belongs to particle `i`. */
type Pool = {
  position: Float32Array;
  velocity: Float32Array;
  colour: Float32Array;
  size: Float32Array;
  lifeShare: Float32Array;
  age: Float32Array;
  maxLife: Float32Array;
  gravity: Float32Array;
  drag: Float32Array;
};

function createPool(capacity: number): Pool {
  return {
    position: new Float32Array(capacity * 3),
    velocity: new Float32Array(capacity * 3),
    colour: new Float32Array(capacity * 3),
    size: new Float32Array(capacity),
    lifeShare: new Float32Array(capacity),
    age: new Float32Array(capacity),
    maxLife: new Float32Array(capacity),
    gravity: new Float32Array(capacity),
    drag: new Float32Array(capacity),
  };
}

/** Linear colour of the particle being spawned; reused so `spawn` allocates nothing. */
const scratchColour = new Color();

function write(pool: Pool, index: number, p: Omit<Particle, "life">): void {
  const at = index * 3;
  pool.position[at] = p.x;
  pool.position[at + 1] = p.y;
  pool.position[at + 2] = p.z;
  pool.velocity[at] = p.vx;
  pool.velocity[at + 1] = p.vy;
  pool.velocity[at + 2] = p.vz;
  scratchColour.setHex(p.colour);
  pool.colour[at] = scratchColour.r;
  pool.colour[at + 1] = scratchColour.g;
  pool.colour[at + 2] = scratchColour.b;
  pool.size[index] = p.size;
  pool.lifeShare[index] = 0;
  pool.age[index] = 0;
  pool.maxLife[index] = p.maxLife;
  pool.gravity[index] = p.gravity;
  pool.drag[index] = p.drag;
}

/** Copies particle `from` into slot `to`. */
function move(pool: Pool, from: number, to: number): void {
  const source = from * 3;
  pool.position.copyWithin(to * 3, source, source + 3);
  pool.velocity.copyWithin(to * 3, source, source + 3);
  pool.colour.copyWithin(to * 3, source, source + 3);
  pool.size[to] = pool.size[from];
  pool.lifeShare[to] = pool.lifeShare[from];
  pool.age[to] = pool.age[from];
  pool.maxLife[to] = pool.maxLife[from];
  pool.gravity[to] = pool.gravity[from];
  pool.drag[to] = pool.drag[from];
}

/** Keeps a particle above the ground, bouncing it softly when it lands. */
function landOnGround(pool: Pool, at: number): void {
  if (pool.position[at + 1] >= 0) return;
  pool.position[at + 1] = 0;
  pool.velocity[at] *= GROUND_FRICTION;
  pool.velocity[at + 1] = Math.abs(pool.velocity[at + 1]) * GROUND_BOUNCE;
  pool.velocity[at + 2] *= GROUND_FRICTION;
}

/** Ages and moves one particle; false once it has lived out its life. */
function step(pool: Pool, index: number, dt: number): boolean {
  const age = pool.age[index] + dt;
  if (age >= pool.maxLife[index]) return false;
  pool.age[index] = age;
  pool.lifeShare[index] = age / pool.maxLife[index];
  const at = index * 3;
  const keep = Math.exp(-pool.drag[index] * dt);
  pool.velocity[at] *= keep;
  pool.velocity[at + 1] =
    pool.velocity[at + 1] * keep - pool.gravity[index] * dt;
  pool.velocity[at + 2] *= keep;
  pool.position[at] += pool.velocity[at] * dt;
  pool.position[at + 1] += pool.velocity[at + 1] * dt;
  pool.position[at + 2] += pool.velocity[at + 2] * dt;
  landOnGround(pool, at);
  return true;
}

function createGeometry(pool: Pool): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(pool.position, 3));
  geometry.setAttribute("aColour", new BufferAttribute(pool.colour, 3));
  geometry.setAttribute("aSize", new BufferAttribute(pool.size, 1));
  geometry.setAttribute("aLife", new BufferAttribute(pool.lifeShare, 1));
  geometry.setDrawRange(0, 0);
  return geometry;
}

/** The buffers the shader reads, which go to the GPU after every update. */
const UPLOADED_ATTRIBUTES = ["position", "aColour", "aSize", "aLife"] as const;

/** Marks the buffers the shader reads for upload. */
function markForUpload(geometry: BufferGeometry): void {
  for (let index = 0; index < UPLOADED_ATTRIBUTES.length; index++)
    geometry.getAttribute(UPLOADED_ATTRIBUTES[index]).needsUpdate = true;
}

/** Feeds the shader the height of the viewport it is about to draw into. */
function sizeForViewport(points: Points, material: ShaderMaterial): void {
  const viewport = new Vector4();
  points.onBeforeRender = (renderer) => {
    renderer.getCurrentViewport(viewport);
    material.uniforms.uViewportHeight.value = viewport.w;
  };
}

/**
 * Creates a pool of particles drawn in one call.
 *
 * @param capacity - Most particles alive at once; every buffer is sized to it up front.
 * @param additive - Additive blending for fire, sparks and embers; normal for smoke and dust.
 * @returns The system; add `object` to the scene and call `update` once per frame.
 */
export function createParticleSystem(
  capacity: number,
  additive: boolean,
): ParticleSystem {
  const pool = createPool(capacity);
  const geometry = createGeometry(pool);
  const material = createParticleMaterial(additive);
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  sizeForViewport(points, material);
  let count = 0;
  let drawn = 0;
  return {
    object: points,
    capacity,
    spawn(p) {
      if (count >= capacity) return;
      write(pool, count, p);
      count += 1;
    },
    update(dt) {
      for (let index = count - 1; index >= 0; index--) {
        if (step(pool, index, dt)) continue;
        count -= 1;
        if (index !== count) move(pool, count, index);
      }
      if (count === 0 && drawn === 0) return;
      drawn = count;
      geometry.setDrawRange(0, count);
      markForUpload(geometry);
    },
    alive: () => count,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
