/**
 * Buildings coming down in 3D (spec §3.5, §6.8). A collapse stands a plain prism in for the building
 * — in the colour of its walls, so the swap does not show, darkening as it falls — and, over
 * {@link COLLAPSE_S}, sinks it into the ground with a slight tilt while dust billows from
 * its footprint and chunks tumble off; a rubble mound shaped to the footprint rises in its place and
 * stays until the structure is rebuilt. Street furniture hit by a car falls over.
 *
 * The collapse builds its own prism from the ring and height it is given; hiding the real building
 * mesh is the caller's job.
 */
import {
  Color,
  Group,
  Mesh,
  MeshLambertMaterial,
  Vector3,
  type ColorRepresentation,
  type Object3D,
} from "three";
import type { Point } from "../world/projection";
import { createDebrisPool, type DebrisPool } from "./debris";
import {
  emitChunk,
  emitPuff,
  rngFor,
  within,
  type ChunkSpec,
  type PuffSpec,
  type Rng,
} from "./fxEmit";
import type { ParticleSystem } from "./particles";
import { footprint, prismGeometry, rubbleGeometry } from "./ruinGeometry";
import { createToppling } from "./toppling";

/** Seconds a building takes to come down (spec §6.8). */
export const COLLAPSE_S = 1.6;
/** Steepest a collapsing building leans, radians (spec §6.8: at most 8°). */
export const COLLAPSE_MAX_TILT_RAD = (8 * Math.PI) / 180;
/** Dust puffs billowing from a collapsing building's footprint (spec §6.8). */
export const COLLAPSE_DUST_COUNT = 60;
/** Chunks tumbling off a collapsing building (spec §6.8). */
export const COLLAPSE_CHUNK_COUNT = 20;
/** Colour of a rubble mound (spec §6.8): a lighter dusty brick-grey, readable on dark tarmac. */
export const RUBBLE_COLOUR = 0x7a6e62;
/** Seconds a knocked piece of furniture takes to hit the ground (spec §6.8). */
export const KNOCK_OVER_S = 0.5;

/** The least a building leans, as a share of the steepest. */
const COLLAPSE_MIN_TILT_SHARE = 0.6;
/** Share of the dust and chunks thrown the moment a building starts to fall, masking the swap. */
const COLLAPSE_BURST_SHARE = 0.3;
/** Share of the collapse over which the rest of the dust and chunks are thrown. */
const COLLAPSE_EMIT_SHARE = 0.75;
/** The shudder as the building gives way: how fast and how far, metres, fading as it sinks. */
const RUMBLE_HZ = 9;
const RUMBLE_M = 0.12;
/** The stand-in's colour when the walls' own is not known: a mid plaster grey. */
export const COLLAPSE_DEFAULT_COLOUR = 0x7f776b;
/** The stand-in darkens to this share of its walls' colour as it comes down, into its own dust. */
export const COLLAPSE_END_SHADE = 0.35;
/** A mound never flattens fully, so its matrix never becomes singular. */
const RUBBLE_MIN_RISE = 0.02;
/** Chunks in flight at once: three collapses' worth. */
const DEBRIS_CAPACITY = 64;
/** Chunks break off between this share of the current roof height and the roof. */
const CHUNK_HEIGHT_SHARE = [0.4, 1] as const;
const FULL_TURN_RAD = Math.PI * 2;

/** Dust rolling out from the foot of the walls. */
const COLLAPSE_DUST: PuffSpec = {
  scatter: 0.6,
  lift: [0.2, 1.6],
  outward: [1.5, 4.5],
  spread: 0.6,
  rise: [0.4, 1.8],
  life: [2.8, 4.2],
  size: [2.2, 3.4],
  colours: [0x6a6258, 0x7a7064, 0x5a534b],
  gravity: -0.15,
  drag: 0.9,
};

/** Brick and concrete breaking off the walls. */
const COLLAPSE_CHUNK: ChunkSpec = {
  scatter: 0.3,
  lift: [0, 0],
  outward: [2, 6],
  spread: 0.7,
  rise: [1, 5],
  life: [3, 4],
  size: [0.35, 0.9],
  colours: [0x8a7f74, 0x6e5a4a, 0x9c8f82, 0x5b4f45],
  spin: [2, 6],
};

/** A building being destroyed: which structure, and its footprint and height. */
export type CollapseInput = {
  structureId: number;
  /** The footprint in world metres, closed or open. */
  ring: readonly Point[];
  /** Roof height, metres. */
  height: number;
  /**
   * The colour of the building's walls: the stand-in starts in it and darkens as it falls;
   * {@link COLLAPSE_DEFAULT_COLOUR} when absent.
   */
  colour?: ColorRepresentation;
};

/** Collapses, rubble and knocked-over furniture. */
export type Destruction3d = {
  /** Add to the scene once. */
  object: Object3D;
  /** Brings a building down over {@link COLLAPSE_S}; ignored while that structure is already falling. */
  collapse(input: CollapseInput): void;
  /** Keeps exactly one mound per listed structure: adds the missing, removes the rebuilt. */
  setRubble(entries: readonly CollapseInput[]): void;
  /** Tips `object` over, away from the world point `(fromX, fromY)`; once per object. */
  knockOver(object: Object3D, fromX: number, fromY: number): void;
  /** Advances collapses, chunks and falling furniture; the lent particles are updated by their owner. */
  update(dt: number): void;
  /** Frees the stand-ins, mounds, chunks and materials; the lent particles stay their owner's. */
  dispose(): void;
};

/** A building on its way down. */
type Collapse = {
  id: number;
  mesh: Mesh;
  /** The stand-in's own material, darkened from {@link Collapse.walls} as it falls. */
  material: MeshLambertMaterial;
  walls: Color;
  centre: Point;
  outline: Point[];
  height: number;
  axis: Vector3;
  tilt: number;
  age: number;
  dust: number;
  chunks: number;
  rng: Rng;
};

/** Share of the fall done at `t`: ease-in, so the building drops ever faster. */
function sunk(t: number): number {
  return t * t;
}

/** Share of the lean at `t`: eased in and out. */
function leaned(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Share of the mound risen at `t`: fast at first, as the rubble piles up. */
function risen(t: number): number {
  return Math.max(RUBBLE_MIN_RISE, 1 - (1 - t) * (1 - t));
}

function startCollapse(input: CollapseInput): Collapse | null {
  const { centre, outline } = footprint(input.ring);
  if (outline.length < 3) return null;
  const rng = rngFor("collapse", input.structureId);
  const lean = rng() * FULL_TURN_RAD;
  const material = new MeshLambertMaterial({
    color: input.colour ?? COLLAPSE_DEFAULT_COLOUR,
  });
  const mesh = new Mesh(prismGeometry(outline, input.height), material);
  mesh.name = "collapse";
  mesh.position.set(centre[0], 0, centre[1]);
  return {
    id: input.structureId,
    mesh,
    material,
    walls: material.color.clone(),
    centre,
    outline,
    height: input.height,
    axis: new Vector3(Math.cos(lean), 0, Math.sin(lean)),
    tilt: COLLAPSE_MAX_TILT_RAD * within(rng, [COLLAPSE_MIN_TILT_SHARE, 1]),
    age: 0,
    dust: 0,
    chunks: 0,
    rng,
  };
}

/** Sinks, leans, shakes and darkens the stand-in for its age. */
function poseCollapse(collapse: Collapse): void {
  const t = Math.min(1, collapse.age / COLLAPSE_S);
  collapse.material.color
    .copy(collapse.walls)
    .multiplyScalar(1 - (1 - COLLAPSE_END_SHADE) * leaned(t));
  const shudder =
    Math.sin(collapse.age * RUMBLE_HZ * FULL_TURN_RAD) * RUMBLE_M * (1 - t);
  collapse.mesh.position.set(
    collapse.centre[0] + collapse.axis.z * shudder,
    -collapse.height * sunk(t),
    collapse.centre[1] - collapse.axis.x * shudder,
  );
  collapse.mesh.quaternion.setFromAxisAngle(
    collapse.axis,
    collapse.tilt * leaned(t),
  );
}

/** How many of `total` should have been thrown by `age`: a burst at once, the rest as it falls. */
function due(total: number, age: number): number {
  const progress = age / (COLLAPSE_S * COLLAPSE_EMIT_SHARE);
  if (progress >= 1) return total;
  return Math.ceil(
    total * (COLLAPSE_BURST_SHARE + (1 - COLLAPSE_BURST_SHARE) * progress),
  );
}

/** Where the next puff or chunk leaves; reused so emitting allocates nothing. */
const edge = { x: 0, y: 0, z: 0 };

/** Puts {@link edge} on a seeded point of the footprint's edge; returns the heading out of the building there. */
function pickEdge(collapse: Collapse, height: number): number {
  const { outline, rng } = collapse;
  const corner = Math.floor(rng() * outline.length);
  const [ax, ay] = outline[corner];
  const [bx, by] = outline[(corner + 1) % outline.length];
  const along = rng();
  const x = ax + (bx - ax) * along;
  const y = ay + (by - ay) * along;
  edge.x = collapse.centre[0] + x;
  edge.y = height;
  edge.z = collapse.centre[1] + y;
  return Math.atan2(y, x);
}

/** Throws the dust and chunks that are due by the collapse's age. */
function throwDue(
  collapse: Collapse,
  particles: ParticleSystem,
  debris: DebrisPool,
): void {
  const dustDue = due(COLLAPSE_DUST_COUNT, collapse.age);
  for (; collapse.dust < dustDue; collapse.dust++) {
    const heading = pickEdge(collapse, 0);
    emitPuff(particles, collapse.rng, COLLAPSE_DUST, edge, heading);
  }
  const roof =
    collapse.height * (1 - sunk(Math.min(1, collapse.age / COLLAPSE_S)));
  const chunksDue = due(COLLAPSE_CHUNK_COUNT, collapse.age);
  for (; collapse.chunks < chunksDue; collapse.chunks++) {
    const heading = pickEdge(
      collapse,
      roof * within(collapse.rng, CHUNK_HEIGHT_SHARE),
    );
    emitChunk(debris, collapse.rng, COLLAPSE_CHUNK, edge, heading);
  }
}

/** The rubble mounds, one per destroyed structure. */
type RubbleField = {
  /** The structure's mound, built if it has none; `null` for a footprint too small to heap. */
  ensure(entry: CollapseInput): Mesh | null;
  get(structureId: number): Mesh | undefined;
  /** Keeps exactly the listed structures' mounds. */
  set(entries: readonly CollapseInput[]): void;
  dispose(): void;
};

function createRubbleField(parent: Group): RubbleField {
  const material = new MeshLambertMaterial({
    color: RUBBLE_COLOUR,
    flatShading: true,
  });
  const mounds = new Map<number, Mesh>();
  const listed = new Set<number>();
  const ensure = (entry: CollapseInput): Mesh | null => {
    const known = mounds.get(entry.structureId);
    if (known) return known;
    const { centre, outline } = footprint(entry.ring);
    if (outline.length < 3) return null;
    const rng = rngFor("rubble", entry.structureId);
    const mound = new Mesh(rubbleGeometry(outline, rng), material);
    mound.name = "rubble";
    mound.position.set(centre[0], 0, centre[1]);
    mounds.set(entry.structureId, mound);
    parent.add(mound);
    return mound;
  };
  return {
    ensure,
    get: (structureId) => mounds.get(structureId),
    set(entries) {
      listed.clear();
      for (const entry of entries) {
        listed.add(entry.structureId);
        ensure(entry);
      }
      for (const [id, mound] of mounds) {
        if (listed.has(id)) continue;
        parent.remove(mound);
        mound.geometry.dispose();
        mounds.delete(id);
      }
    },
    dispose() {
      for (const mound of mounds.values()) mound.geometry.dispose();
      mounds.clear();
      material.dispose();
    },
  };
}

/** The buildings coming down. */
type Collapses = {
  /** Starts a collapse unless that structure is already falling or its footprint is too small. */
  start(input: CollapseInput): void;
  update(dt: number): void;
  dispose(): void;
};

/** Where a collapse throws its dust and chunks, and where its mound rises. */
type CollapseTargets = {
  parent: Group;
  dust: ParticleSystem;
  debris: DebrisPool;
  rubble: RubbleField;
};

function createCollapses(targets: CollapseTargets): Collapses {
  const { parent, dust, debris, rubble } = targets;
  const falling = new Map<number, Collapse>();
  const advance = (collapse: Collapse, dt: number): void => {
    collapse.age += dt;
    throwDue(collapse, dust, debris);
    const done = collapse.age >= COLLAPSE_S;
    const mound = rubble.get(collapse.id);
    if (mound) mound.scale.y = done ? 1 : risen(collapse.age / COLLAPSE_S);
    if (!done) {
      poseCollapse(collapse);
      return;
    }
    parent.remove(collapse.mesh);
    collapse.mesh.geometry.dispose();
    collapse.material.dispose();
    falling.delete(collapse.id);
  };
  return {
    start(input) {
      if (falling.has(input.structureId)) return;
      const collapse = startCollapse(input);
      if (!collapse) return;
      falling.set(collapse.id, collapse);
      parent.add(collapse.mesh);
      const mound = rubble.ensure(input);
      if (mound) mound.scale.y = RUBBLE_MIN_RISE;
      throwDue(collapse, dust, debris);
    },
    update(dt) {
      for (const collapse of falling.values()) advance(collapse, dt);
    },
    dispose() {
      for (const collapse of falling.values()) {
        collapse.mesh.geometry.dispose();
        collapse.material.dispose();
      }
      falling.clear();
    },
  };
}

/**
 * Creates the destruction view.
 *
 * @param particles - A normal-blended particle pool for the dust (e.g. `Effects3d.smoke`); its
 *   owner updates and disposes it.
 * @returns The view; call `update` once per frame.
 */
export function createDestruction3d(particles: ParticleSystem): Destruction3d {
  const debris = createDebrisPool(DEBRIS_CAPACITY);
  const toppling = createToppling(KNOCK_OVER_S);
  const object = new Group();
  object.name = "destruction";
  object.add(debris.object);
  const rubble = createRubbleField(object);
  const collapses = createCollapses({
    parent: object,
    dust: particles,
    debris,
    rubble,
  });
  return {
    object,
    collapse: (input) => collapses.start(input),
    setRubble: (entries) => rubble.set(entries),
    knockOver: (target, fromX, fromY) => toppling.knock(target, fromX, fromY),
    update(dt) {
      collapses.update(dt);
      debris.update(dt);
      toppling.update(dt);
    },
    dispose() {
      collapses.dispose();
      rubble.dispose();
      debris.dispose();
    },
  };
}
