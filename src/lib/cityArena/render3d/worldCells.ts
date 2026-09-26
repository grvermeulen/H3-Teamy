/**
 * The streamed 3D city: builds the cells around the camera from the loaded map tiles, nearest
 * first under a per-frame time budget, drops the ones left far behind, rebuilds a cell when a
 * building in it falls or is rebuilt (or its tile arrives), and scorches damaged buildings.
 */
import { Group } from "three";
import type { DecodedTile } from "../world/decode";
import { structureMaxHealth } from "../world/structureId";
import {
  buildCell,
  tilesReaching,
  type BuiltCell,
  type FurnitureInstance,
  type LandmarkStyles,
} from "./buildCell";
import { shadeBuilding, type BuildingRange } from "./buildingMesh";
import {
  cellKey,
  cellsWithin,
  distanceToCell,
  type CellCoord,
} from "./cellGrid";
import type { WorldMaterials } from "./worldMaterials";

/** Cells are kept until they are this many view distances away, so turning round does not rebuild. */
export const KEEP_DISTANCE_FACTOR = 1.4;

/**
 * What the city needs to know about a damaged or destroyed building; the simulation's structure
 * state has these fields (and more).
 */
export type StructureView = {
  id: number;
  damage: number;
  destroyedAtTick: number | null;
};

/** The streamed city. */
export type WorldCells = {
  /** Every built cell; add it to the scene once, at `renderOrder` 0. */
  group: Group;
  /**
   * Streams the city around `focus`, once per frame: rebuilds cells whose buildings fell or rose
   * again, then builds missing cells nearest first until `budgetMs` has passed (always at least
   * one), drops cells beyond 1.4 × `viewDistance`, copies moved furniture proxies into their
   * instances, and shades each damaged building by its share of health.
   */
  update(
    focus: { x: number; y: number },
    tiles: readonly DecodedTile[],
    structures: readonly StructureView[],
    viewDistance: number,
    budgetMs: number,
  ): void;
  /** The furniture of the built cells within `radius` metres of a point, for cosmetic knock-over. */
  furnitureNear(x: number, y: number, radius: number): FurnitureInstance[];
  /** Frees every cell; the shared materials stay with their owner. */
  dispose(): void;
};

/** A building's walls range (none while destroyed) and health, for shading. */
type Health = { range: BuildingRange | undefined; maxHealth: number };

/** One built cell and what it was built from. */
type CellState = {
  cell: CellCoord;
  built: BuiltCell;
  tiles: string;
  destroyed: string;
  health: Map<number, Health>;
  /** The damage share each scorched building is shaded at. */
  shaded: Map<number, number>;
};

/** The city's cells and the cell owning each building id. */
type City = {
  materials: WorldMaterials;
  landmarks: LandmarkStyles | undefined;
  group: Group;
  cells: Map<string, CellState>;
  owners: Map<number, string>;
};

/** What one frame streams from. */
type Frame = {
  focus: { x: number; y: number };
  tiles: readonly DecodedTile[];
  destroyed: ReadonlySet<number>;
  viewDistance: number;
};

/** Build urgency: a cell whose building fell (or rose again) goes before a missing one. */
const COLLAPSE_URGENCY = 0;
const MISSING_URGENCY = 1;

/** The keys of the tiles reaching a cell, as one string. */
function tileSignature(cell: CellCoord, tiles: readonly DecodedTile[]): string {
  return tilesReaching(cell, tiles)
    .map((tile) => `${tile.x}:${tile.y}`)
    .join(" ");
}

/** The destroyed ids among a cell's buildings, sorted, as one string. */
function destroyedSignature(
  health: ReadonlyMap<number, Health>,
  destroyed: ReadonlySet<number>,
): string {
  return [...destroyed]
    .filter((id) => health.has(id))
    .sort((left, right) => left - right)
    .join(" ");
}

/** The ids of the destroyed structures. */
function destroyedIds(structures: readonly StructureView[]): Set<number> {
  return new Set(
    structures
      .filter((structure) => structure.destroyedAtTick !== null)
      .map((structure) => structure.id),
  );
}

/** Each owned building's walls range and health, by id. */
function healthOf(built: BuiltCell): Map<number, Health> {
  const ranges = new Map(
    built.ranges.map((range) => [range.structureId, range]),
  );
  return new Map(
    built.buildings.map((building) => [
      building.structureId,
      {
        range: ranges.get(building.structureId),
        maxHealth: structureMaxHealth(
          building.ring,
          building.levels,
          Boolean(building.landmark),
        ),
      },
    ]),
  );
}

/** Frees a cell and forgets it. */
function dropCell(city: City, key: string): void {
  const state = city.cells.get(key);
  if (!state) return;
  for (const id of state.health.keys()) {
    if (city.owners.get(id) === key) city.owners.delete(id);
  }
  state.built.dispose();
  city.cells.delete(key);
}

/** Builds (or rebuilds) one cell, replacing what stood there. */
function buildInto(city: City, cell: CellCoord, frame: Frame): void {
  const key = cellKey(cell);
  const tiles = tilesReaching(cell, frame.tiles);
  const { destroyed } = frame;
  const { materials, landmarks } = city;
  const built = buildCell({ cell, tiles, destroyed, materials, landmarks });
  dropCell(city, key);
  const health = healthOf(built);
  city.cells.set(key, {
    cell,
    built,
    tiles: tileSignature(cell, tiles),
    destroyed: destroyedSignature(health, destroyed),
    health,
    shaded: new Map(),
  });
  for (const id of health.keys()) city.owners.set(id, key);
  city.group.add(built.group);
}

/** How urgently a cell needs building, or null when it is up to date. */
function urgencyOf(city: City, cell: CellCoord, frame: Frame): number | null {
  const state = city.cells.get(cellKey(cell));
  if (!state) return MISSING_URGENCY;
  const destroyed = destroyedSignature(state.health, frame.destroyed);
  if (destroyed !== state.destroyed) return COLLAPSE_URGENCY;
  return tileSignature(cell, frame.tiles) !== state.tiles
    ? MISSING_URGENCY
    : null;
}

/** Builds the cells in view that need it, most urgent and nearest first, within the budget. */
function streamCells(city: City, frame: Frame, budgetMs: number): void {
  const start = performance.now();
  const work = cellsWithin(frame.focus.x, frame.focus.y, frame.viewDistance)
    .map((cell, order) => ({
      cell,
      order,
      urgency: urgencyOf(city, cell, frame),
    }))
    .filter((entry) => entry.urgency !== null)
    .sort(
      (left, right) =>
        (left.urgency ?? 0) - (right.urgency ?? 0) || left.order - right.order,
    );
  let built = 0;
  for (const { cell } of work) {
    if (built > 0 && performance.now() - start >= budgetMs) break;
    buildInto(city, cell, frame);
    built += 1;
  }
}

/** Drops the cells beyond {@link KEEP_DISTANCE_FACTOR} view distances. */
function evictCells(city: City, frame: Frame): void {
  const keep = KEEP_DISTANCE_FACTOR * frame.viewDistance;
  for (const [key, state] of [...city.cells]) {
    const { x, y } = frame.focus;
    if (distanceToCell(x, y, state.cell) > keep) dropCell(city, key);
  }
}

/** Restores the walls of a cell's buildings that are no longer damaged. */
function healCell(
  state: CellState,
  damaged: ReadonlyMap<number, number>,
): void {
  for (const id of [...state.shaded.keys()]) {
    if (damaged.has(id)) continue;
    const range = state.health.get(id)?.range;
    if (range && state.built.walls) shadeBuilding(state.built.walls, range, 0);
    state.shaded.delete(id);
  }
}

/** Shades every damaged standing building by its share of health, where the share changed. */
function shadeDamaged(city: City, structures: readonly StructureView[]): void {
  const damaged = new Map<number, number>();
  for (const { id, damage, destroyedAtTick } of structures) {
    if (destroyedAtTick === null && damage > 0) damaged.set(id, damage);
  }
  for (const state of city.cells.values()) healCell(state, damaged);
  for (const [id, damage] of damaged) {
    const state = city.cells.get(city.owners.get(id) ?? "");
    const health = state?.health.get(id);
    if (!state?.built.walls || !health?.range) continue;
    const share = damage / health.maxHealth;
    if (state.shaded.get(id) === share) continue;
    shadeBuilding(state.built.walls, health.range, share);
    state.shaded.set(id, share);
  }
}

/**
 * Creates the streamed city.
 *
 * @param materials - The shared materials every cell draws with.
 * @param landmarks - Landmark styles by key (the world session's landmark lookup), for dressing.
 * @returns The city; call `update` every frame and `dispose` when the 3D view closes.
 */
export function createWorldCells(
  materials: WorldMaterials,
  landmarks?: LandmarkStyles,
): WorldCells {
  const city: City = {
    materials,
    landmarks,
    group: new Group(),
    cells: new Map(),
    owners: new Map(),
  };
  return {
    group: city.group,
    update(focus, tiles, structures, viewDistance, budgetMs) {
      const destroyed = destroyedIds(structures);
      const frame: Frame = { focus, tiles, destroyed, viewDistance };
      evictCells(city, frame);
      streamCells(city, frame, budgetMs);
      for (const state of city.cells.values()) state.built.syncFurniture();
      shadeDamaged(city, structures);
    },
    furnitureNear(x, y, radius) {
      return [...city.cells.values()]
        .filter((state) => distanceToCell(x, y, state.cell) <= radius)
        .flatMap((state) => state.built.furniture)
        .filter((piece) => Math.hypot(piece.x - x, piece.y - y) <= radius);
    },
    dispose() {
      for (const key of [...city.cells.keys()]) dropCell(city, key);
      city.group.clear();
    },
  };
}
