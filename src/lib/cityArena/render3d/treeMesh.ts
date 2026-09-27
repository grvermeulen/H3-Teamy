/**
 * Trees of the 3D city, instanced per cell: one mesh of trunks and one of canopies per green, so
 * a street of fifty trees costs three draw calls.
 */
import {
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type MeshLambertMaterial,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TREE_CANOPY_M, type TreeSize } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { idUnit } from "./idHash";
import type { WorldMaterials } from "./worldMaterials";

/** Clear trunk under the canopy, metres. */
export const TRUNK_CLEAR_M = 2.4;
/** Trunk diameter, metres. */
export const TRUNK_DIAMETER_M = 0.35;
/** How far the trunk reaches up into the canopy, so no gap shows under a round crown, metres. */
const TRUNK_INSET_M = 0.8;
/** The top of the trunk is this share of its foot, a slight taper. */
const TRUNK_TAPER = 0.75;
/** Sides of the trunk's cylinder. */
const TRUNK_SIDES = 6;
/** Subdivisions of the main crown's icosahedron: 80 faces, round enough at street level. */
const CROWN_DETAIL = 1;
/** The smaller crown layered on top: its radius and offset, as shares of the main crown. */
const TOP_CROWN_RADIUS = 0.68;
const TOP_CROWN_OFFSET: readonly [number, number, number] = [0.2, 0.55, -0.12];
/** A tree's size varies by up to this share either way. */
const SIZE_JITTER = 0.15;
/** Salts naming each seeded choice about a tree. */
const TURN_SALT = 0x71;
const SIZE_SALT = 0x72;

/** A tree to plant: world position, size class and a stable id (its parity picks the green). */
export type TreeInput = { point: Point; size: TreeSize; id: number };

/** A cell's trees: the meshes to add to the cell, and how to free their geometry. */
export type TreeLayer = { meshes: InstancedMesh[]; dispose(): void };

/** A unit crown: a main sphere with a smaller one layered on top, the whole radius about 1. */
function crownGeometry(): BufferGeometry {
  const main = new IcosahedronGeometry(1, CROWN_DETAIL);
  const top = new IcosahedronGeometry(TOP_CROWN_RADIUS, 0).translate(
    ...TOP_CROWN_OFFSET,
  );
  const merged = mergeGeometries([main, top]);
  main.dispose();
  top.dispose();
  return merged;
}

/** A trunk standing on the ground, 2.4 m clear and reaching on up into the crown. */
function trunkGeometry(): BufferGeometry {
  const height = TRUNK_CLEAR_M + TRUNK_INSET_M;
  const radius = TRUNK_DIAMETER_M / 2;
  return new CylinderGeometry(
    radius * TRUNK_TAPER,
    radius,
    height,
    TRUNK_SIDES,
  ).translate(0, height / 2, 0);
}

/** One instanced mesh holding a matrix per tree. */
function instanced(
  geometry: BufferGeometry,
  material: MeshLambertMaterial,
  matrices: readonly Matrix4[],
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** A tree's crown radius, jittered by its id. */
function crownRadius(tree: TreeInput): number {
  const jitter = 1 + (idUnit(tree.id, SIZE_SALT) * 2 - 1) * SIZE_JITTER;
  return (TREE_CANOPY_M[tree.size] / 2) * jitter;
}

/**
 * Instanced trees for one cell: trunks (0.35 m wide, 2.4 m clear) and crowns of radius
 * `TREE_CANOPY_M[size] / 2` centred `2.4 + radius` up, each turned and sized a little by its id,
 * the lighter green on even ids and the deeper on odd.
 *
 * @param trees - The cell's trees.
 * @param materials - The shared set (trunk and the two canopy greens).
 * @param origin - The world point that is the cell's local zero.
 * @returns The meshes (none for no trees) and a disposer for their geometry and instance buffers.
 */
export function buildTreeLayer(
  trees: readonly TreeInput[],
  materials: WorldMaterials,
  origin: Point,
): TreeLayer {
  if (trees.length === 0) return { meshes: [], dispose: () => {} };
  const up = new Vector3(0, 1, 0);
  const trunks: Matrix4[] = [];
  const crowns: [Matrix4[], Matrix4[]] = [[], []];
  for (const tree of trees) {
    const [x, z] = [tree.point[0] - origin[0], tree.point[1] - origin[1]];
    trunks.push(new Matrix4().makeTranslation(x, 0, z));
    const radius = crownRadius(tree);
    const turn = new Quaternion().setFromAxisAngle(
      up,
      idUnit(tree.id, TURN_SALT) * 2 * Math.PI,
    );
    const crown = new Matrix4().compose(
      new Vector3(x, TRUNK_CLEAR_M + radius, z),
      turn,
      new Vector3(radius, radius, radius),
    );
    crowns[tree.id % 2].push(crown);
  }
  const [trunk, crown] = [trunkGeometry(), crownGeometry()];
  const meshes = [
    instanced(trunk, materials.treeTrunk, trunks),
    ...crowns.flatMap((matrices, green) =>
      matrices.length > 0
        ? [instanced(crown, materials.canopies[green], matrices)]
        : [],
    ),
  ];
  return {
    meshes,
    dispose: () => {
      for (const mesh of meshes) mesh.dispose();
      trunk.dispose();
      crown.dispose();
    },
  };
}
