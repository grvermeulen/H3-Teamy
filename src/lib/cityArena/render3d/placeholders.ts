/**
 * A stand-in for the 3D city until the real world cells (Task 11) are wired in (Task 16): a
 * tarmac ground plane and grey extruded footprints for the buildings near the player — enough to
 * drive and walk around. The layer mirrors the shape of `WorldCells`, so swapping it is a
 * one-line change in `index.ts`.
 */
import {
  ExtrudeGeometry,
  GridHelper,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Shape,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import type { DecodedBuilding, DecodedTile } from "../world/decode";
import { disposeObject } from "./disposal";
import type { StructureView } from "./index";

/** Buildings farther than this from the player are not built, metres (the brief's 200 m). */
export const PLACEHOLDER_BUILDING_RADIUS_M = 200;
/** A building is dropped again only beyond this share of the radius, so edges do not flicker. */
const BUILDING_KEEP_SHARE = 1.25;
/** The player must move this far before the building set is scanned again, metres. */
const RESCAN_DISTANCE_M = 16;
/** Storey height and the lowest building, metres (spec §6.5). */
const STOREY_M = 3.1;
const MIN_BUILDING_HEIGHT_M = 3.5;
/** Side of the ground plane that follows the player, metres; fog hides its edge. */
const GROUND_SIZE_M = 2400;
/** A world-fixed grid on the ground gives the eye something to judge speed by, metres. */
const GRID_CELL_M = 10;
const GRID_SIZE_M = 600;
/** The grid floats this far over the ground so the two never z-fight, metres. */
const GRID_LIFT_M = 0.02;
/** Placeholder colours: dark tarmac and grey buildings. */
const TARMAC = 0x2b2e33;
const GRID_LINE = 0x4a515c;
const BUILDING_GREY = 0x8a8f98;

/** Squared distance from `(x, y)` to the nearest point of a rectangle. */
function distanceSquaredToRect(
  x: number,
  y: number,
  rect: DecodedBuilding["bounds"],
): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dy = Math.max(rect.minY - y, 0, y - rect.maxY);
  return dx * dx + dy * dy;
}

/**
 * A footprint extruded to its height (spec §6.5: `levels × 3.1 m`, at least 3.5 m). The shape is
 * drawn with y negated and turned −90° about X, which lays world `(x, y)` onto three's `(x, 0, y)`
 * and extrudes upward.
 *
 * @param building - The decoded footprint.
 * @returns The geometry in world coordinates, or `null` for a degenerate ring.
 */
export function buildingGeometry(
  building: DecodedBuilding,
): BufferGeometry | null {
  if (building.ring.length < 3) return null;
  const shape = new Shape();
  building.ring.forEach(([x, y], index) =>
    index === 0 ? shape.moveTo(x, -y) : shape.lineTo(x, -y),
  );
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(MIN_BUILDING_HEIGHT_M, building.levels * STOREY_M),
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** The ground and buildings layer; same `update` shape as the real `WorldCells`. */
export type PlaceholderWorld = {
  group: Group;
  update(
    focus: { x: number; y: number },
    tiles: readonly DecodedTile[],
    structures: readonly StructureView[],
    viewDistance: number,
    budgetMs: number,
  ): void;
  /** How many buildings are standing in the layer. */
  buildingCount(): number;
  dispose(): void;
};

/** Same tiles in the same order: the session hands out a fresh array each frame. */
function sameTiles(
  first: readonly DecodedTile[],
  second: readonly DecodedTile[],
): boolean {
  return (
    first.length === second.length &&
    first.every((tile, index) => tile === second[index])
  );
}

/** The ids of destroyed structures. */
function destroyedIds(
  structures: readonly StructureView[],
): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const structure of structures)
    if (structure.destroyedAtTick !== null) ids.add(structure.id);
  return ids;
}

/** A key that changes exactly when the set of destroyed structures does; `""` while none is. */
function destroyedKey(structures: readonly StructureView[]): string {
  let key = "";
  for (const structure of structures)
    if (structure.destroyedAtTick !== null) key += `${structure.id},`;
  return key;
}

/** Building bookkeeping for {@link createPlaceholderWorld}. */
type BuildingLayer = {
  group: Group;
  material: Material;
  built: Map<number, { mesh: Mesh; building: DecodedBuilding }>;
  queue: DecodedBuilding[];
};

/** Drops buildings beyond the keep radius or destroyed, then queues the missing ones nearest first. */
function rescanBuildings(
  layer: BuildingLayer,
  focus: { x: number; y: number },
  tiles: readonly DecodedTile[],
  destroyed: ReadonlySet<number>,
  radius: number,
): void {
  const keep = (radius * BUILDING_KEEP_SHARE) ** 2;
  for (const [id, entry] of layer.built) {
    const far = distanceSquaredToRect(focus.x, focus.y, entry.building.bounds);
    if (far <= keep && !destroyed.has(id)) continue;
    layer.group.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    layer.built.delete(id);
  }
  const reach = radius * radius;
  const distance = (building: DecodedBuilding): number =>
    distanceSquaredToRect(focus.x, focus.y, building.bounds);
  layer.queue = tiles
    .flatMap((tile) => tile.buildings)
    .filter(
      (building) =>
        !layer.built.has(building.structureId) &&
        !destroyed.has(building.structureId) &&
        distance(building) <= reach,
    )
    .sort((first, second) => distance(first) - distance(second));
}

/** Builds queued buildings until `budgetMs` runs out, always at least one per call. */
function buildQueued(layer: BuildingLayer, budgetMs: number): void {
  const start = performance.now();
  let first = true;
  while (layer.queue.length > 0) {
    if (!first && performance.now() - start >= budgetMs) return;
    first = false;
    const building = layer.queue.shift()!;
    const geometry = buildingGeometry(building);
    if (!geometry) continue;
    const mesh = new Mesh(geometry, layer.material);
    layer.group.add(mesh);
    layer.built.set(building.structureId, { mesh, building });
  }
}

/** What the building set was last scanned for. */
type Scan = {
  x: number;
  y: number;
  tiles: readonly DecodedTile[];
  destroyed: string;
};

/** True when the player moved far enough, the tiles changed or a building fell since `scan`. */
function needsRescan(scan: Scan | null, next: Scan): boolean {
  return (
    !scan ||
    Math.hypot(next.x - scan.x, next.y - scan.y) >= RESCAN_DISTANCE_M ||
    !sameTiles(next.tiles, scan.tiles) ||
    next.destroyed !== scan.destroyed
  );
}

/** A tarmac plane that follows the player, with a grid fixed to the world over it. */
function createGround(): {
  objects: Object3D[];
  follow(focus: { x: number; y: number }): void;
} {
  const ground = new Mesh(
    new PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M),
    new MeshLambertMaterial({ color: TARMAC }),
  );
  ground.rotation.x = -Math.PI / 2;
  const grid = new GridHelper(
    GRID_SIZE_M,
    GRID_SIZE_M / GRID_CELL_M,
    GRID_LINE,
    GRID_LINE,
  );
  const snap = (metres: number): number =>
    Math.round(metres / GRID_CELL_M) * GRID_CELL_M;
  return {
    objects: [ground, grid],
    follow(focus) {
      ground.position.set(focus.x, 0, focus.y);
      grid.position.set(snap(focus.x), GRID_LIFT_M, snap(focus.y));
    },
  };
}

/**
 * The placeholder city: a ground plane under the player and grey extruded footprints within
 * {@link PLACEHOLDER_BUILDING_RADIUS_M} (or the view distance, if shorter). The set is rescanned
 * only when the player has moved {@link RESCAN_DISTANCE_M}, the loaded tiles or the destroyed
 * buildings changed; new buildings are built nearest first within the frame's budget.
 *
 * @returns The layer; add its `group` to the scene.
 */
export function createPlaceholderWorld(): PlaceholderWorld {
  const group = new Group();
  const ground = createGround();
  const layer: BuildingLayer = {
    group: new Group(),
    material: new MeshLambertMaterial({ color: BUILDING_GREY }),
    built: new Map(),
    queue: [],
  };
  group.add(ground.objects[0]!, layer.group, ground.objects[1]!);
  let scanned: Scan | null = null;
  return {
    group,
    update(focus, tiles, structures, viewDistance, budgetMs) {
      ground.follow(focus);
      const destroyed = destroyedKey(structures);
      const next = { x: focus.x, y: focus.y, tiles, destroyed };
      if (needsRescan(scanned, next)) {
        const radius = Math.min(viewDistance, PLACEHOLDER_BUILDING_RADIUS_M);
        rescanBuildings(layer, focus, tiles, destroyedIds(structures), radius);
        scanned = next;
      }
      buildQueued(layer, budgetMs);
    },
    buildingCount: () => layer.built.size,
    dispose() {
      // The shared building material hangs off no mesh once every building is gone.
      disposeObject(group);
      layer.material.dispose();
      layer.built.clear();
    },
  };
}
