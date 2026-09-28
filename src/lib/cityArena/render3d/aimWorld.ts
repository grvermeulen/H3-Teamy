/**
 * The aim probe's world (aim spec §5), read from a frame: everyone in the street, every vehicle,
 * and the standing buildings of the loaded tiles near the ray, found through each tile's building
 * buckets. The lists reuse their entries from frame to frame and the buildings are handed out
 * through a visitor, so the steady state allocates nothing.
 */
import { rectsIntersect, type Rect } from "../mapBuild/geometry";
import type { Scene } from "../render/renderScene";
import { lengthOf, widthOf } from "../sim/vehicle";
import type { DecodedBuilding, DecodedTile } from "../world/decode";
import type {
  AimBuildingVisitor,
  AimCharacter,
  AimVehicle,
  AimWorld,
} from "./aimProbe";
import { visitArea } from "./bucketGrid";
import { buildingHeight } from "./buildingMesh";
import { tileBuildingGrid } from "./tileIndex";
import { vehicleHeight } from "./vehicleModels";
import type { StructureView } from "./worldCells";

/** What the aim world reads from a scene. */
export type AimScene = Pick<
  Scene,
  "players" | "peds" | "cops" | "vehicles" | "localPlayerId"
>;

/** The probe's world, refreshed from every frame. */
export type AimWorldSource = AimWorld & {
  /**
   * Reads a frame: its people and vehicles, the loaded tiles and the fallen buildings.
   *
   * @param scene - The frame's scene.
   * @param tiles - The loaded map tiles.
   * @param structures - The damaged and destroyed buildings; destroyed ones are looked through.
   */
  sync(
    scene: AimScene,
    tiles: readonly DecodedTile[],
    structures: readonly StructureView[],
  ): void;
};

/** A list rebuilt every frame from entries that outlive it. */
type Pooled<T> = { pool: T[]; list: T[] };

/** The entry at `index` of this frame's list, taken from the pool (made there on first use). */
function entryAt<T>(pooled: Pooled<T>, index: number, make: () => T): T {
  let entry = pooled.pool[index];
  if (entry === undefined) {
    entry = make();
    pooled.pool[index] = entry;
  }
  pooled.list[index] = entry;
  return entry;
}

function newCharacter(): AimCharacter {
  return { x: 0, y: 0, dead: false, self: false };
}

function newVehicle(): AimVehicle {
  return { x: 0, y: 0, heading: 0, length: 0, width: 0, height: 0, own: false };
}

/** Writes one person into this frame's list. */
function putCharacter(
  pooled: Pooled<AimCharacter>,
  index: number,
  person: { x: number; y: number },
  dead: boolean,
  self: boolean,
): void {
  const entry = entryAt(pooled, index, newCharacter);
  entry.x = person.x;
  entry.y = person.y;
  entry.dead = dead;
  entry.self = self;
}

/** Everyone on foot, the pedestrians and the officers; players in a car are inside its box. */
function syncCharacters(pooled: Pooled<AimCharacter>, scene: AimScene): void {
  let count = 0;
  for (const player of scene.players) {
    if (player.vehicleId !== null) continue;
    const self = player.id === scene.localPlayerId;
    putCharacter(pooled, count++, player, player.diedAtTick !== null, self);
  }
  for (const ped of scene.peds)
    putCharacter(pooled, count++, ped, ped.mode === "dead", false);
  for (const cop of scene.cops)
    putCharacter(pooled, count++, cop, cop.diedAtTick !== null, false);
  pooled.list.length = count;
}

/** The car the local player drives, or `null` on foot. */
function ownVehicleId(scene: AimScene): number | null {
  for (const player of scene.players)
    if (player.id === scene.localPlayerId) return player.vehicleId;
  return null;
}

/** Every vehicle, wrecks included, as a box of its kind's footprint and height. */
function syncVehicles(pooled: Pooled<AimVehicle>, scene: AimScene): void {
  const own = ownVehicleId(scene);
  for (let index = 0; index < scene.vehicles.length; index += 1) {
    const vehicle = scene.vehicles[index];
    const entry = entryAt(pooled, index, newVehicle);
    entry.x = vehicle.x;
    entry.y = vehicle.y;
    entry.heading = vehicle.heading;
    entry.length = lengthOf(vehicle.kind);
    entry.width = widthOf(vehicle.kind);
    entry.height = vehicleHeight(vehicle.kind);
    entry.own = vehicle.id === own;
  }
  pooled.list.length = scene.vehicles.length;
}

/** True when the building with this structure id has fallen. */
function fallen(structures: readonly StructureView[], id: number): boolean {
  for (const structure of structures)
    if (structure.id === id) return structure.destroyedAtTick !== null;
  return false;
}

/** The loaded tiles' standing buildings, visited through their buckets. */
type BuildingLookup = AimWorld["buildings"] & {
  tiles: readonly DecodedTile[];
  structures: readonly StructureView[];
};

/** Nothing visited yet. */
const NO_AREA: Readonly<Rect> = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
function ignoreBuilding(): void {}

/** A lookup whose visit hands each standing building meeting the area to the visitor. */
function createBuildingLookup(): BuildingLookup {
  // What the visit in progress looks through, read by the one bucket visitor below, so a visit
  // makes no closure.
  let buildings: readonly DecodedBuilding[] = [];
  let area = NO_AREA;
  let onBuilding: AimBuildingVisitor = ignoreBuilding;
  const lookup: BuildingLookup = {
    tiles: [],
    structures: [],
    visit(box, visitor) {
      area = box;
      onBuilding = visitor;
      for (const tile of lookup.tiles) {
        buildings = tile.buildings;
        visitArea(tileBuildingGrid(tile), box, onPosition);
      }
    },
  };
  const onPosition = (position: number): void => {
    const building = buildings[position];
    if (!rectsIntersect(building.bounds, area)) return;
    if (fallen(lookup.structures, building.structureId)) return;
    onBuilding(building.ring, buildingHeight(building.levels));
  };
  return lookup;
}

/**
 * Creates the probe's world; call `sync` with each frame before probing.
 *
 * @returns The world.
 */
export function createAimWorld(): AimWorldSource {
  const characters: Pooled<AimCharacter> = { pool: [], list: [] };
  const vehicles: Pooled<AimVehicle> = { pool: [], list: [] };
  const buildings = createBuildingLookup();
  return {
    characters: characters.list,
    vehicles: vehicles.list,
    buildings,
    sync(scene, tiles, structures) {
      syncCharacters(characters, scene);
      syncVehicles(vehicles, scene);
      buildings.tiles = tiles;
      buildings.structures = structures;
    },
  };
}
