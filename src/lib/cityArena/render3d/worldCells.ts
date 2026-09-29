/**
 * The streamed 3D city: builds the cells around the camera from the loaded map tiles, nearest
 * first under a per-frame time budget, drops the ones left far behind, rebuilds a cell when a
 * building in it falls or is rebuilt (or its tile arrives), and scorches damaged buildings.
 *
 * `update` runs every frame, so it compares its inputs with the last frame's and does no
 * look-up, building or shading work (nor the allocations that go with it) unless something
 * changed: the tiles, the structure list, the focus by {@link REFRESH_DISTANCE_M}, the view
 * distance, or work the budget left for later.
 */
import { Group, type Quaternion } from "three";
import type { StructureState } from "../sim/types";
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
import type { CityDetail } from "./cityDetail";
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
 * How far the focus may drift before the cells in view are looked up again, metres; the edge of
 * the built city trails the exact view distance by at most this much.
 */
export const REFRESH_DISTANCE_M = 16;

/**
 * Furniture positions are matched across a cell's rebuilds on a grid this fine, metres: a rebuilt
 * cell places its pieces from the same map data, so this only absorbs rounding.
 */
const FURNITURE_KEY_STEP_M = 0.1;

/**
 * What the 3D view needs to know about a damaged or destroyed building: the part of the
 * simulation's structure state that decides its shading and whether it stands.
 */
export type StructureView = Pick<
  StructureState,
  "id" | "damage" | "destroyedAtTick"
>;

/** The streamed city. */
export type WorldCells = {
  /** Every built cell; add it to the scene once, at `renderOrder` 0. */
  group: Group;
  /**
   * Streams the city around `focus`, once per frame: rebuilds the cells whose buildings fell or
   * rose again at once, whatever the budget (so a fallen building vanishes the frame it falls),
   * then cells whose tiles changed and missing cells, nearest first, until `budgetMs` has passed
   * (always at least one), drops cells beyond 1.4 × `viewDistance`, copies moved furniture
   * proxies (those handed out by `furnitureNear`) into their instances, and shades each damaged
   * building by its share of health. With unchanged inputs it only checks for movement. A new
   * `detail` level marks every built cell for rebuilding, nearest first under the budget.
   */
  update(
    focus: { x: number; y: number },
    tiles: readonly DecodedTile[],
    structures: readonly StructureView[],
    viewDistance: number,
    budgetMs: number,
    detail?: CityDetail,
  ): void;
  /**
   * The furniture of the built cells standing within `radius` metres of a point, for cosmetic
   * knock-over — pieces kept down are left out; from then on `update` mirrors each returned
   * piece's proxy. Pass `into` to have it emptied and filled instead of a new list made, for
   * searches run every frame.
   */
  furnitureNear(
    x: number,
    y: number,
    radius: number,
    into?: FurnitureInstance[],
  ): FurnitureInstance[];
  /**
   * Remembers that a knocked-over piece lies in `pose` (its proxy's final rotation): searches
   * leave it out, and when its cell is rebuilt — a building in it fell or rose again — the rebuilt
   * piece is laid straight down in that pose. Forgotten once the cell is dropped.
   */
  keepDown(piece: FurnitureInstance, pose: Quaternion): void;
  /** Frees every cell; the shared materials stay with their owner. */
  dispose(): void;
};

/** A building's walls range (none while destroyed) and health, for shading. */
type Health = { range: BuildingRange | undefined; maxHealth: number };

/** One built cell and what it was built from. */
type CellState = {
  cell: CellCoord;
  built: BuiltCell;
  /** The sorted keys of the tiles it was built from. */
  tiles: string;
  health: Map<number, Health>;
  /** The damage share each scorched building is shaded at. */
  shaded: Map<number, number>;
  /** Pieces handed out by `furnitureNear`, whose proxies are mirrored every update. */
  live: Set<FurnitureInstance>;
  /**
   * The fallen pose of each knocked-over piece, by {@link furnitureKey}: carried over when the
   * cell is rebuilt, dropped with the cell.
   */
  down: Map<string, Quaternion>;
  /** The cell's present pieces that lie knocked over. */
  downPieces: Set<FurnitureInstance>;
};

/** A piece's identity across its cell's rebuilds: its kind and where it stands. */
function furnitureKey(piece: FurnitureInstance): string {
  const x = Math.round(piece.x / FURNITURE_KEY_STEP_M);
  const y = Math.round(piece.y / FURNITURE_KEY_STEP_M);
  return `${piece.kind}:${x}:${y}`;
}

/** Lays the rebuilt cell's pieces that were knocked over before straight down again. */
function restoreDown(state: CellState): void {
  if (state.down.size === 0) return;
  for (const piece of state.built.furniture) {
    const pose = state.down.get(furnitureKey(piece));
    if (!pose) continue;
    piece.object.quaternion.copy(pose);
    state.downPieces.add(piece);
    state.live.add(piece);
  }
}

/** Records a knocked-over piece's fallen pose in the cell that holds it. */
function keepDown(
  city: City,
  piece: FurnitureInstance,
  pose: Quaternion,
): void {
  for (const state of city.cells.values()) {
    if (!state.built.furniture.includes(piece)) continue;
    state.down.set(furnitureKey(piece), pose.clone());
    state.downPieces.add(piece);
    return;
  }
}

/** A cell in view, with its key. */
type WantedCell = { cell: CellCoord; key: string };

/** A furniture search in progress; one per city, reused so a search allocates nothing. */
type FurnitureQuery = {
  x: number;
  y: number;
  radius: number;
  found: FurnitureInstance[];
};

/** The streamed city's state between updates. */
type City = {
  materials: WorldMaterials;
  landmarks: LandmarkStyles | undefined;
  group: Group;
  cells: Map<string, CellState>;
  /** The cell owning each building id. */
  owners: Map<number, string>;
  /** The tiles as last given, in order. */
  tiles: readonly DecodedTile[];
  /** The detail level cells are built at. */
  detail: CityDetail;
  /** The damage of every listed structure, and the destroyed ones among them. */
  damage: Map<number, number>;
  destroyed: Set<number>;
  /** The cells in view from where they were last looked up, nearest first. */
  wanted: WantedCell[];
  lookedFrom: { x: number; y: number } | null;
  viewDistance: number;
  /**
   * Built cells a building fell or rose again in: rebuilt in the same update whatever the budget,
   * so a collapsing building's real walls vanish the frame its stand-in starts to fall.
   */
  fallen: Set<string>;
  /** Built cells to rebuild (their tiles changed) before any missing one is built. */
  stale: Set<string>;
  /** Whether the budget ran out with cells in view still to build. */
  pending: boolean;
  /** Whether damage shading must be applied again. */
  shadeDirty: boolean;
  query: FurnitureQuery;
  /** Adds a cell's furniture within {@link City.query} to its list; made once per city. */
  searchCell: (state: CellState) => void;
};

/** A build budget: when it started, what it allows, and how many cells it has paid for. */
type Budget = { start: number; limitMs: number; built: number };

/** The keys of the tiles reaching a cell, sorted, as one string. */
function tileSignature(cell: CellCoord, tiles: readonly DecodedTile[]): string {
  return tilesReaching(cell, tiles)
    .map((tile) => `${tile.x}:${tile.y}`)
    .sort()
    .join(" ");
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
  city.stale.delete(key);
  city.fallen.delete(key);
}

/** Builds (or rebuilds) one cell from the current tiles and destroyed set. */
function buildInto(city: City, cell: CellCoord, key: string): void {
  const tiles = tilesReaching(cell, city.tiles);
  const { destroyed, materials, landmarks, detail } = city;
  const built = buildCell({
    cell,
    tiles,
    destroyed,
    materials,
    landmarks,
    detail,
  });
  const down = city.cells.get(key)?.down ?? new Map<string, Quaternion>();
  dropCell(city, key);
  const health = healthOf(built);
  const state: CellState = {
    cell,
    built,
    tiles: tileSignature(cell, tiles),
    health,
    shaded: new Map(),
    live: new Set(),
    down,
    downPieces: new Set(),
  };
  restoreDown(state);
  city.cells.set(key, state);
  for (const id of health.keys()) city.owners.set(id, key);
  city.group.add(built.group);
  city.shadeDirty = true;
}

/**
 * True when two tile lists hold the same tiles in the same order; the world session hands out a
 * fresh list every frame, so identity of the lists says nothing.
 *
 * @param left - One list.
 * @param right - The other.
 * @returns Whether they match element by element.
 */
export function sameTiles(
  left: readonly DecodedTile[],
  right: readonly DecodedTile[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Takes a new tile list; marks the built cells whose set of tiles changed. */
function syncTiles(city: City, tiles: readonly DecodedTile[]): void {
  if (sameTiles(city.tiles, tiles)) return;
  city.tiles = [...tiles];
  for (const [key, state] of city.cells) {
    if (tileSignature(state.cell, city.tiles) !== state.tiles) {
      city.stale.add(key);
    }
  }
}

/** Takes a detail level; a new one marks every built cell for rebuilding. */
function syncDetail(city: City, detail: CityDetail): void {
  if (detail === city.detail) return;
  city.detail = detail;
  for (const key of city.cells.keys()) city.stale.add(key);
}

/** True when the structure list differs from the last one in any damage or destruction. */
function structuresChanged(
  city: City,
  structures: readonly StructureView[],
): boolean {
  if (structures.length !== city.damage.size) return true;
  for (const { id, damage, destroyedAtTick } of structures) {
    if (city.damage.get(id) !== damage) return true;
    if ((destroyedAtTick !== null) !== city.destroyed.has(id)) return true;
  }
  return false;
}

/** Marks the cell owning a building for rebuilding this update, if it is built. */
function markOwner(city: City, id: number): void {
  const key = city.owners.get(id);
  if (key !== undefined) city.fallen.add(key);
}

/**
 * Takes a changed structure list: marks the cells whose buildings fell or rose again, and asks
 * for the damage shading to be applied again.
 */
function syncStructures(
  city: City,
  structures: readonly StructureView[],
): void {
  if (!structuresChanged(city, structures)) return;
  const damage = new Map<number, number>();
  const destroyed = new Set<number>();
  for (const structure of structures) {
    damage.set(structure.id, structure.damage);
    if (structure.destroyedAtTick !== null) destroyed.add(structure.id);
  }
  for (const id of destroyed) if (!city.destroyed.has(id)) markOwner(city, id);
  for (const id of city.destroyed) if (!destroyed.has(id)) markOwner(city, id);
  city.damage = damage;
  city.destroyed = destroyed;
  city.shadeDirty = true;
}

/**
 * Looks up the cells in view again, and drops the far ones, once the focus has drifted
 * {@link REFRESH_DISTANCE_M} or the view distance changed.
 *
 * @returns Whether it looked.
 */
function lookAround(
  city: City,
  focus: { x: number; y: number },
  viewDistance: number,
): boolean {
  const from = city.lookedFrom;
  const drift = from ? Math.hypot(focus.x - from.x, focus.y - from.y) : 0;
  if (
    from &&
    viewDistance === city.viewDistance &&
    drift < REFRESH_DISTANCE_M
  ) {
    return false;
  }
  city.lookedFrom = { x: focus.x, y: focus.y };
  city.viewDistance = viewDistance;
  city.wanted = cellsWithin(focus.x, focus.y, viewDistance).map((cell) => ({
    cell,
    key: cellKey(cell),
  }));
  const keep = KEEP_DISTANCE_FACTOR * viewDistance;
  for (const [key, state] of city.cells) {
    if (distanceToCell(focus.x, focus.y, state.cell) > keep)
      dropCell(city, key);
  }
  return true;
}

/** True once the budget has paid for a cell and its time is up. */
function spent(budget: Budget): boolean {
  return budget.built > 0 && performance.now() - budget.start >= budget.limitMs;
}

/** Rebuilds every cell a building fell or rose again in: paid for from the budget, never deferred. */
function rebuildFallen(city: City, budget: Budget): void {
  for (const key of city.fallen) {
    const state = city.cells.get(key);
    if (!state) continue;
    buildInto(city, state.cell, key);
    budget.built += 1;
  }
  if (city.fallen.size > 0) city.fallen.clear();
}

/** Rebuilds the stale cells, those in view nearest first; false when the budget ran out. */
function rebuildStale(city: City, budget: Budget): boolean {
  for (const { cell, key } of city.wanted) {
    if (!city.stale.has(key)) continue;
    if (spent(budget)) return false;
    buildInto(city, cell, key);
    budget.built += 1;
  }
  for (const key of city.stale) {
    const state = city.cells.get(key);
    if (!state) {
      city.stale.delete(key);
      continue;
    }
    if (spent(budget)) return false;
    buildInto(city, state.cell, key);
    budget.built += 1;
  }
  return true;
}

/** Builds the missing cells in view, nearest first; false when the budget ran out. */
function buildMissing(city: City, budget: Budget): boolean {
  for (const { cell, key } of city.wanted) {
    if (city.cells.has(key)) continue;
    if (spent(budget)) return false;
    buildInto(city, cell, key);
    budget.built += 1;
  }
  return true;
}

/** Restores the walls of a cell's buildings that are no longer damaged (or have fallen). */
function healCell(city: City, state: CellState): void {
  for (const id of state.shaded.keys()) {
    const damage = city.damage.get(id) ?? 0;
    if (damage > 0 && !city.destroyed.has(id)) continue;
    const range = state.health.get(id)?.range;
    if (range && state.built.walls) shadeBuilding(state.built.walls, range, 0);
    state.shaded.delete(id);
  }
}

/** Shades every damaged standing building by its share of health, where the share changed. */
function shadeDamaged(city: City): void {
  city.shadeDirty = false;
  for (const state of city.cells.values()) {
    if (state.shaded.size > 0) healCell(city, state);
  }
  for (const [id, damage] of city.damage) {
    if (damage <= 0 || city.destroyed.has(id)) continue;
    const state = city.cells.get(city.owners.get(id) ?? "");
    const health = state?.health.get(id);
    if (!state?.built.walls || !health?.range) continue;
    const share = damage / health.maxHealth;
    if (state.shaded.get(id) === share) continue;
    shadeBuilding(state.built.walls, health.range, share);
    state.shaded.set(id, share);
  }
}

/** Adds a cell's furniture within the query's reach to its list, and mirrors it from now on. */
function searchCell(state: CellState, query: FurnitureQuery): void {
  const { x, y, radius, found } = query;
  if (distanceToCell(x, y, state.cell) > radius) return;
  const furniture = state.built.furniture;
  for (let index = 0; index < furniture.length; index++) {
    const piece = furniture[index];
    if (state.downPieces.has(piece)) continue;
    if (Math.hypot(piece.x - x, piece.y - y) > radius) continue;
    found.push(piece);
    state.live.add(piece);
  }
}

/** The furniture standing within `radius` of a point, in `into` (emptied first), now mirrored every update. */
function handOutFurniture(
  city: City,
  x: number,
  y: number,
  radius: number,
  into: FurnitureInstance[],
): FurnitureInstance[] {
  into.length = 0;
  const { query } = city;
  query.x = x;
  query.y = y;
  query.radius = radius;
  query.found = into;
  city.cells.forEach(city.searchCell);
  return into;
}

/** A city with nothing built yet. */
function emptyCity(
  materials: WorldMaterials,
  landmarks: LandmarkStyles | undefined,
): City {
  const query: FurnitureQuery = { x: 0, y: 0, radius: 0, found: [] };
  return {
    materials,
    landmarks,
    group: new Group(),
    cells: new Map(),
    owners: new Map(),
    tiles: [],
    detail: "basic",
    damage: new Map(),
    destroyed: new Set(),
    wanted: [],
    lookedFrom: null,
    viewDistance: 0,
    fallen: new Set(),
    stale: new Set(),
    pending: false,
    shadeDirty: false,
    query,
    searchCell: (state) => searchCell(state, query),
  };
}

/** One frame of streaming: see {@link WorldCells.update}. */
function updateCity(
  city: City,
  focus: { x: number; y: number },
  frame: {
    tiles: readonly DecodedTile[];
    structures: readonly StructureView[];
  },
  viewDistance: number,
  budgetMs: number,
  detail: CityDetail,
): void {
  syncDetail(city, detail);
  syncTiles(city, frame.tiles);
  syncStructures(city, frame.structures);
  const looked = lookAround(city, focus, viewDistance);
  const work = city.fallen.size > 0 || city.stale.size > 0 || city.pending;
  if (looked || work) {
    const budget = { start: performance.now(), limitMs: budgetMs, built: 0 };
    rebuildFallen(city, budget);
    city.pending = !(rebuildStale(city, budget) && buildMissing(city, budget));
  }
  for (const state of city.cells.values()) {
    if (state.live.size > 0) state.built.syncFurniture(state.live);
  }
  if (city.shadeDirty) shadeDamaged(city);
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
  const city = emptyCity(materials, landmarks);
  return {
    group: city.group,
    update: (focus, tiles, structures, viewDistance, budgetMs, detail) =>
      updateCity(
        city,
        focus,
        { tiles, structures },
        viewDistance,
        budgetMs,
        detail ?? "basic",
      ),
    furnitureNear: (x, y, radius, into = []) =>
      handOutFurniture(city, x, y, radius, into),
    keepDown: (piece, pose) => keepDown(city, piece, pose),
    dispose() {
      for (const key of city.cells.keys()) dropCell(city, key);
      city.wanted = [];
      city.lookedFrom = null;
      city.pending = false;
      city.group.clear();
    },
  };
}
