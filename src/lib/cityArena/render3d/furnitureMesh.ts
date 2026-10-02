/**
 * Street furniture of the 3D city — lamps, benches and bus shelters — instanced per cell and
 * part, with an additive halo on every lamp head. Each piece also has a pose proxy: an `Object3D`
 * that is never drawn, whose transform the layer copies into the instances on {@link
 * FurnitureLayer.sync}, so a cosmetic knock-over can animate the proxy like any object.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Object3D,
  Points,
  Quaternion,
  Vector3,
  type Material,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FURNITURE_SIZE_M, type FurnitureKind } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { headingToRotationY } from "./coords";
import { createLampPools, lampPoolMatrix } from "./lampPools";
import type { WorldMaterials } from "./worldMaterials";

/** A lamp's pole height, metres. */
export const LAMP_POLE_M = 4.5;
/** How far the lamp's arm reaches out toward the road, metres. */
const LAMP_ARM_M = 0.6;
/** Pole radius at the foot and at the top, metres. */
const LAMP_POLE_FOOT_M = 0.09;
const LAMP_POLE_TOP_M = 0.06;
/** Sides of the pole's cylinder. */
const LAMP_POLE_SIDES = 8;
/** Thickness of the arm, metres. */
const LAMP_ARM_THICKNESS_M = 0.06;
/** The lamp head's box: along the arm, height, across; metres. */
const LAMP_HEAD_M: readonly [number, number, number] = [0.55, 0.14, 0.3];
/** The glow's centre sits this far under the head, metres. */
const GLOW_DROP_M = 0.12;
/** Seat height of a bench, metres. */
const BENCH_SEAT_M = 0.45;
/** Plank thickness of the seat and back, metres. */
const BENCH_PLANK_M = 0.07;
/** Height of the bench's back rest, metres. */
const BENCH_BACK_M = 0.4;
/** The seat's depth as a share of the bench's footprint across. */
const BENCH_SEAT_DEPTH_SHARE = 0.7;
/** Clear height under a bus shelter's roof, metres. */
const SHELTER_HEIGHT_M = 2.4;
/** Thickness of the shelter's posts and roof, metres. */
const SHELTER_FRAME_M = 0.08;
/** Height of the shelter's glass panels and how far above the ground they start, metres. */
const SHELTER_GLASS_M = 1.9;
const SHELTER_GLASS_FOOT_M = 0.25;
/** Thickness of a glass panel, metres. */
const GLASS_THICKNESS_M = 0.03;
/** The lit advertising panel at the shelter's open end: height and thickness, metres. */
const POSTER_HEIGHT_M = 1.7;
const POSTER_THICKNESS_M = 0.06;
/** The poster's width as a share of the shelter's depth. */
const POSTER_WIDTH_SHARE = 0.8;
/**
 * How far under the ground a hidden lamp's halo is sunk, metres: deep enough that the painted
 * ground hides the whole point sprite from any eye height.
 */
const HIDDEN_GLOW_DEPTH_M = 10;

/** A piece of furniture in the world, with the proxy that poses it. */
export type FurnitureInstance = {
  kind: FurnitureKind;
  x: number;
  y: number;
  heading: number;
  /**
   * The piece's pose proxy, at `(x, 0, y)` turned to `heading`, never drawn itself: move, turn or
   * hide it and the cell copies the change into its instances on the next update.
   */
  object: Object3D;
};

/** A piece of furniture to place: kind, world position and heading (its long side's direction). */
export type PlacedFurniture = Omit<FurnitureInstance, "object">;

/** A cell's furniture: objects for the cell group, the pieces, and the proxy → instance copy. */
export type FurnitureLayer = {
  objects: Object3D[];
  furniture: FurnitureInstance[];
  /**
   * Copies the proxies that moved, turned or were hidden since the last copy into the
   * instances: only `pieces` when given (e.g. the ones handed out for a knock-over), else all.
   */
  sync(pieces?: Iterable<FurnitureInstance>): void;
  dispose(): void;
};

/** One part of a kind: its geometry in the piece's frame (+X along the heading) and material. */
type Part = {
  build: () => BufferGeometry;
  material: (materials: WorldMaterials) => Material;
};

/** A box of the given size centred at a point of the piece's frame. */
function box(
  size: readonly [number, number, number],
  centre: readonly [number, number, number],
): BoxGeometry {
  return new BoxGeometry(...size).translate(...centre) as BoxGeometry;
}

/** Merges parts into one geometry and frees the parts. */
function merged(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return geometry;
}

/** The pole and its arm, reaching along +X. */
function lampPole(): BufferGeometry {
  const pole = new CylinderGeometry(
    LAMP_POLE_TOP_M,
    LAMP_POLE_FOOT_M,
    LAMP_POLE_M,
    LAMP_POLE_SIDES,
  ).translate(0, LAMP_POLE_M / 2, 0);
  const arm = box(
    [LAMP_ARM_M, LAMP_ARM_THICKNESS_M, LAMP_ARM_THICKNESS_M],
    [LAMP_ARM_M / 2, LAMP_POLE_M - LAMP_ARM_THICKNESS_M, 0],
  );
  return merged([pole, arm]);
}

/** Where the lamp head hangs, in the piece's frame. */
const LAMP_HEAD_AT: readonly [number, number, number] = [
  LAMP_ARM_M,
  LAMP_POLE_M - LAMP_ARM_THICKNESS_M - LAMP_HEAD_M[1] / 2,
  0,
];

/** A bench along +X: seat, back rest toward −Z, and two legs. */
function bench(): BufferGeometry {
  const [length, depth] = FURNITURE_SIZE_M.bench;
  const legX = length / 2 - BENCH_PLANK_M;
  const seatDepth = depth * BENCH_SEAT_DEPTH_SHARE;
  return merged([
    box([length, BENCH_PLANK_M, seatDepth], [0, BENCH_SEAT_M, 0]),
    box(
      [length, BENCH_BACK_M, BENCH_PLANK_M],
      [0, BENCH_SEAT_M + BENCH_BACK_M / 2, -depth / 2 + BENCH_PLANK_M],
    ),
    ...[-legX, legX].map((x) =>
      box([BENCH_PLANK_M, BENCH_SEAT_M, seatDepth], [x, BENCH_SEAT_M / 2, 0]),
    ),
  ]);
}

/** A shelter's frame: four posts and the roof over its footprint. */
function shelterFrame(): BufferGeometry {
  const [length, depth] = FURNITURE_SIZE_M.busStop;
  const post: readonly [number, number, number] = [
    SHELTER_FRAME_M,
    SHELTER_HEIGHT_M,
    SHELTER_FRAME_M,
  ];
  const corners = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => [sx, sz] as const),
  );
  return merged([
    ...corners.map(([sx, sz]) =>
      box(post, [
        (sx * (length - SHELTER_FRAME_M)) / 2,
        SHELTER_HEIGHT_M / 2,
        (sz * (depth - SHELTER_FRAME_M)) / 2,
      ]),
    ),
    box([length, SHELTER_FRAME_M, depth], [0, SHELTER_HEIGHT_M, 0]),
  ]);
}

/** The shelter's glass: a back panel along −Z and a side panel at −X. */
function shelterGlass(): BufferGeometry {
  const [length, depth] = FURNITURE_SIZE_M.busStop;
  const y = SHELTER_GLASS_FOOT_M + SHELTER_GLASS_M / 2;
  return merged([
    box(
      [length, SHELTER_GLASS_M, GLASS_THICKNESS_M],
      [0, y, -depth / 2 + SHELTER_FRAME_M],
    ),
    box(
      [GLASS_THICKNESS_M, SHELTER_GLASS_M, depth],
      [-length / 2 + SHELTER_FRAME_M, y, 0],
    ),
  ]);
}

/** The lit advertising panel closing the shelter's +X end. */
function shelterPoster(): BufferGeometry {
  const [length, depth] = FURNITURE_SIZE_M.busStop;
  return box(
    [POSTER_THICKNESS_M, POSTER_HEIGHT_M, depth * POSTER_WIDTH_SHARE],
    [
      length / 2 - SHELTER_FRAME_M,
      SHELTER_GLASS_FOOT_M + POSTER_HEIGHT_M / 2,
      0,
    ],
  );
}

/** The parts each kind is made of. */
const PARTS: Record<FurnitureKind, readonly Part[]> = {
  lamp: [
    { build: lampPole, material: (materials) => materials.lampPole },
    {
      build: () => box(LAMP_HEAD_M, LAMP_HEAD_AT),
      material: (materials) => materials.lampHead,
    },
  ],
  bench: [{ build: bench, material: (materials) => materials.bench }],
  busStop: [
    { build: shelterFrame, material: (materials) => materials.lampPole },
    { build: shelterGlass, material: (materials) => materials.shelterGlass },
    { build: shelterPoster, material: (materials) => materials.lampHead },
  ],
};

/** The glow's centre in a lamp's frame. */
const GLOW_AT = new Vector3(
  LAMP_HEAD_AT[0],
  LAMP_HEAD_AT[1] - GLOW_DROP_M,
  LAMP_HEAD_AT[2],
);
/** The lamp head's middle in a lamp's frame, which its pool of light lies under. */
const HEAD_AT = new Vector3(...LAMP_HEAD_AT);
/** Scale that hides a piece whose proxy is invisible. */
const HIDDEN = new Vector3(0, 0, 0);

/** A proxy standing at a piece's world position, turned to its heading. */
function proxyFor(piece: PlacedFurniture): Object3D {
  const proxy = new Object3D();
  proxy.position.set(piece.x, 0, piece.y);
  proxy.rotation.y = headingToRotationY(piece.heading);
  proxy.updateMatrix();
  return proxy;
}

/** One kind's instanced parts, the pieces (by index into the layer) they draw, and whether a
 * piece's instances changed since they were last uploaded. */
type KindMeshes = {
  kind: FurnitureKind;
  meshes: InstancedMesh[];
  pieces: number[];
  dirty: boolean;
};

/** The instanced meshes of one kind, one per part, sized to its pieces. */
function kindMeshes(
  kind: FurnitureKind,
  pieces: number[],
  materials: WorldMaterials,
): KindMeshes {
  const meshes = PARTS[kind].map((part) => {
    const mesh = new InstancedMesh(
      part.build(),
      part.material(materials),
      pieces.length,
    );
    mesh.matrixAutoUpdate = false;
    return mesh;
  });
  return { kind, meshes, pieces, dirty: false };
}

/** The halo points over the lamps, one vertex per lamp. */
function glowPoints(count: number, materials: WorldMaterials): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array(count * 3), 3),
  );
  const points = new Points(geometry, materials.lampGlow);
  points.matrixAutoUpdate = false;
  return points;
}

/** The halo points over a layer's lamps and, when asked, the pools of light under them. */
function lampLights(
  kinds: readonly KindMeshes[],
  materials: WorldMaterials,
  withPools: boolean,
): LampLights {
  const lamps = kinds.find((entry) => entry.kind === "lamp");
  if (!lamps) return { glow: null, pools: null };
  const count = lamps.pieces.length;
  return {
    glow: glowPoints(count, materials),
    pools: withPools ? createLampPools(count, materials.lampPool) : null,
  };
}

/**
 * Instanced furniture for one cell: per kind one mesh per part (lamp: pole with arm, glowing
 * head; bench; shelter: frame, glass, lit poster), one halo point per lamp, a pool of light under
 * each lamp when asked, and a pose proxy per piece (see {@link FurnitureInstance.object}).
 *
 * @param pieces - The cell's furniture, headings already turned to face the road.
 * @param materials - The shared set.
 * @param origin - The world point that is the cell's local zero.
 * @param options - `pools`: lay a pool of light on the street under every lamp.
 * @returns The layer; call `sync` each frame and `dispose` with the cell.
 */
export function buildFurnitureLayer(
  pieces: readonly PlacedFurniture[],
  materials: WorldMaterials,
  origin: Point,
  options: { pools?: boolean } = {},
): FurnitureLayer {
  const furniture = pieces.map((piece) => ({
    ...piece,
    object: proxyFor(piece),
  }));
  const kinds = (Object.keys(PARTS) as FurnitureKind[])
    .map((kind) => ({
      kind,
      indices: furniture.flatMap((piece, index) =>
        piece.kind === kind ? [index] : [],
      ),
    }))
    .filter(({ indices }) => indices.length > 0)
    .map(({ kind, indices }) => kindMeshes(kind, indices, materials));
  const lights = lampLights(kinds, materials, options.pools ?? false);
  const { glow, pools } = lights;
  const poser = createPoser(furniture, kinds, lights, origin);
  for (const piece of furniture) writePose(poser, piece);
  flushPoses(poser);
  const objects: Object3D[] = [
    ...kinds.flatMap((entry) => entry.meshes),
    ...(glow ? [glow] : []),
    ...(pools ? [pools] : []),
  ];
  return {
    objects,
    furniture,
    sync: (pieces = furniture) => {
      for (const piece of pieces) {
        const slot = poser.slots.get(piece);
        if (slot && hasMoved(slot, piece.object)) writePose(poser, piece);
      }
      flushPoses(poser);
    },
    dispose: () => {
      for (const mesh of kinds.flatMap((entry) => entry.meshes)) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
      glow?.geometry.dispose();
      pools?.geometry.dispose();
      pools?.dispose();
    },
  };
}

/** Where a piece's instances sit, and the proxy pose they were last written from. */
type PieceSlot = {
  kind: KindMeshes;
  slot: number;
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
  visible: boolean;
};

/** What lights the lamps: their halo points and the pools of light under them, when built. */
type LampLights = { glow: Points | null; pools: InstancedMesh | null };

/** A layer's pieces by proxy, its lamps' lights, and scratch space for writing poses. */
type Poser = LampLights & {
  slots: Map<FurnitureInstance, PieceSlot>;
  kinds: readonly KindMeshes[];
  shift: Matrix4;
  pose: Matrix4;
  glowAt: Vector3;
  poolPose: Matrix4;
};

/** A poser for the layer's pieces, each mapped to its kind and slot. */
function createPoser(
  furniture: readonly FurnitureInstance[],
  kinds: readonly KindMeshes[],
  lights: LampLights,
  origin: Point,
): Poser {
  const slots = new Map<FurnitureInstance, PieceSlot>();
  for (const kind of kinds) {
    kind.pieces.forEach((pieceIndex, slot) => {
      slots.set(furniture[pieceIndex], {
        kind,
        slot,
        position: new Vector3(),
        quaternion: new Quaternion(),
        scale: new Vector3(),
        visible: true,
      });
    });
  }
  const shift = new Matrix4().makeTranslation(-origin[0], 0, -origin[1]);
  return {
    slots,
    kinds,
    ...lights,
    shift,
    pose: new Matrix4(),
    glowAt: new Vector3(),
    poolPose: new Matrix4(),
  };
}

/** True when a proxy's pose differs from the one its instances were written from. */
function hasMoved(slot: PieceSlot, proxy: Object3D): boolean {
  return (
    slot.visible !== proxy.visible ||
    !slot.position.equals(proxy.position) ||
    !slot.quaternion.equals(proxy.quaternion) ||
    !slot.scale.equals(proxy.scale)
  );
}

/** Moves a lamp's halo and pool with its pose; a hidden lamp's halo sinks underground. */
function writeLampLights(
  poser: Poser,
  slot: number,
  pose: Matrix4,
  shown: boolean,
): void {
  if (poser.pools)
    poser.pools.setMatrixAt(
      slot,
      lampPoolMatrix(pose, HEAD_AT, shown, poser.poolPose),
    );
  if (!poser.glow) return;
  const glowAt = poser.glowAt.copy(GLOW_AT).applyMatrix4(pose);
  if (!shown) glowAt.y = -HIDDEN_GLOW_DEPTH_M;
  poser.glow.geometry
    .getAttribute("position")
    .setXYZ(slot, glowAt.x, glowAt.y, glowAt.z);
}

/** Writes a piece's proxy pose into its instances (and its lamp's lights), marking its kind dirty. */
function writePose(poser: Poser, piece: FurnitureInstance): void {
  const slot = poser.slots.get(piece);
  if (!slot) return;
  const proxy = piece.object;
  slot.position.copy(proxy.position);
  slot.quaternion.copy(proxy.quaternion);
  slot.scale.copy(proxy.scale);
  slot.visible = proxy.visible;
  proxy.updateMatrix();
  const pose = poser.pose.multiplyMatrices(poser.shift, proxy.matrix);
  if (!proxy.visible) pose.scale(HIDDEN);
  for (const mesh of slot.kind.meshes) mesh.setMatrixAt(slot.slot, pose);
  slot.kind.dirty = true;
  if (slot.kind.kind === "lamp")
    writeLampLights(poser, slot.slot, pose, proxy.visible);
}

/** Uploads the lamps' halos and pools after a pose was written to them. */
function flushLampLights(poser: Poser): void {
  if (poser.glow) {
    poser.glow.geometry.getAttribute("position").needsUpdate = true;
    poser.glow.geometry.computeBoundingSphere();
  }
  if (poser.pools) {
    poser.pools.instanceMatrix.needsUpdate = true;
    poser.pools.computeBoundingSphere();
  }
}

/** Uploads the instances (and lamp lights) of every kind a pose was written to since the last flush. */
function flushPoses(poser: Poser): void {
  for (const kind of poser.kinds) {
    if (!kind.dirty) continue;
    kind.dirty = false;
    for (const mesh of kind.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    if (kind.kind === "lamp") flushLampLights(poser);
  }
}
