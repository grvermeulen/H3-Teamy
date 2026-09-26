/**
 * Which buildings lie in ruins, read from the frame's structure list (spec §3.5, §6.8). The list
 * is all a networked client gets — the simulation's `collapse` events never cross the wire — so a
 * collapse is found by comparing the destroyed ids with the last frame's: a building newly listed
 * as destroyed comes down if it fell moments ago, or is simply a heap of rubble if it fell long
 * before this view saw it (switching to 3D, or walking into range of an old ruin).
 */
import { clipPolygonToRect } from "../mapBuild/geometry";
import { SIM_STEP_S } from "../sim/player";
import type { DecodedTile } from "../world/decode";
import { structureTileOf } from "../world/structureId";
import { buildingHeight, facadeStyleOf } from "./buildingMesh";
import type { CollapseInput, Destruction3d } from "./destruction3d";
import { facadeWallColour } from "./textures";
import { sameTiles, type StructureView } from "./worldCells";

/** How long after a building fell the view still plays its collapse, seconds; later it is rubble. */
export const RECENT_COLLAPSE_S = 2;
/** {@link RECENT_COLLAPSE_S} in 30 Hz simulation ticks. */
export const RECENT_COLLAPSE_TICKS = Math.round(RECENT_COLLAPSE_S / SIM_STEP_S);
/** The fewest corners a footprint needs to heap up or fall. */
const MIN_RING_CORNERS = 3;

/** What the ruins ask of the destruction view. */
export type RuinTarget = Pick<Destruction3d, "collapse" | "setRubble">;

/**
 * The footprint, height and wall colour a structure id names, as the city builds it: the building
 * at the id's position in its tile, cut to the tile's own rectangle, in its façade's paint.
 *
 * @param id - A structure id.
 * @param tiles - The loaded tiles.
 * @returns Its collapse input, or `null` while its tile is not loaded or the id names no building.
 */
export function ruinOf(
  id: number,
  tiles: readonly DecodedTile[],
): CollapseInput | null {
  const { tileX, tileY, index } = structureTileOf(id);
  const tile = tiles.find(
    (candidate) => candidate.x === tileX && candidate.y === tileY,
  );
  const building = tile?.buildings[index];
  if (!tile || !building) return null;
  const ring = clipPolygonToRect(building.ring, tile.rect);
  if (ring.length < MIN_RING_CORNERS) return null;
  return {
    structureId: id,
    ring,
    height: buildingHeight(building.levels),
    colour: facadeWallColour(facadeStyleOf(building)),
  };
}

/** The ruins as the destruction view last heard of them. */
export type Ruins3d = {
  /**
   * Compares the frame's destroyed structures with the last frame's: starts the collapse of each
   * newly destroyed building that fell in the last {@link RECENT_COLLAPSE_TICKS} before `tick`
   * (never one stamped after it), and hands
   * `setRubble` every destroyed building's footprint whenever that set (or the tiles) changed.
   * Allocates nothing while both stay the same.
   */
  update(
    structures: readonly StructureView[],
    tiles: readonly DecodedTile[],
    tick: number,
    target: RuinTarget,
  ): void;
};

/** Destroyed ids of the last frame and this one (swapped each frame), and the tiles last seen. */
type RuinState = {
  known: Set<number>;
  next: Set<number>;
  tiles: DecodedTile[];
};

/** Takes the tiles if they differ from the last ones, element by element; true when they did. */
function syncTiles(state: RuinState, tiles: readonly DecodedTile[]): boolean {
  if (sameTiles(state.tiles, tiles)) return false;
  state.tiles = [...tiles];
  return true;
}

/** Records this frame's destroyed ids, collapsing the recent new ones; true when any is new. */
function collectDestroyed(
  state: RuinState,
  structures: readonly StructureView[],
  tick: number,
  target: RuinTarget,
): boolean {
  let fresh = false;
  if (state.next.size > 0) state.next.clear();
  for (const { id, destroyedAtTick } of structures) {
    if (destroyedAtTick === null) continue;
    state.next.add(id);
    if (state.known.has(id)) continue;
    fresh = true;
    const age = tick - destroyedAtTick;
    // A fall stamped after this tick means the tick count restarted: it is an old ruin.
    if (age < 0 || age > RECENT_COLLAPSE_TICKS) continue;
    const ruin = ruinOf(id, state.tiles);
    if (ruin) target.collapse(ruin);
  }
  return fresh;
}

/** Every destroyed building's footprint that the loaded tiles hold. */
function ruinsOf(
  ids: ReadonlySet<number>,
  tiles: readonly DecodedTile[],
): CollapseInput[] {
  const ruins: CollapseInput[] = [];
  for (const id of ids) {
    const ruin = ruinOf(id, tiles);
    if (ruin) ruins.push(ruin);
  }
  return ruins;
}

/**
 * Creates the ruin tracker.
 *
 * @returns The tracker; call `update` once per frame with the frame's structures.
 */
export function createRuins3d(): Ruins3d {
  const state: RuinState = { known: new Set(), next: new Set(), tiles: [] };
  return {
    update(structures, tiles, tick, target) {
      const tilesChanged = syncTiles(state, tiles);
      const fresh = collectDestroyed(state, structures, tick, target);
      const changed = fresh || state.next.size !== state.known.size;
      const known = state.next;
      state.next = state.known;
      state.known = known;
      if (changed || tilesChanged)
        target.setRubble(ruinsOf(state.known, state.tiles));
    },
  };
}
