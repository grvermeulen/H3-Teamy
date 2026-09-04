/** Integer map units per metre: the asset stores coordinates at 0.25 m resolution. */
export const MAP_UNITS_PER_METRE = 4;

/** Numbers per edge in `MapRoads.edges`: a, b, classIndex, nameIndex, oneway, lengthUnits. */
export const ROAD_EDGE_STRIDE = 6;

/** Keys of the four match zones. */
export type ZoneKey = "rhenen" | "wageningen" | "campus" | "bennekom";

/** Visual style a landmark building is drawn with. */
export type LandmarkStyle = "church" | "pool" | "campus" | "cafe";

/** Drivable road classes kept from OpenStreetMap (`*_link` collapsed onto the base class). */
export type RoadClass =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "unclassified"
  | "residential"
  | "living_street"
  | "pedestrian"
  | "service";

/** Ground fill categories derived from land use. */
export type GroundKind = "grass" | "field" | "forest" | "urban";

/** Axis-aligned bounds in map units. */
export type MapBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** One tile entry in the index. */
export type MapTileRef = { x: number; y: number; file: string; bytes: number };

/** A recognisable building or place, positioned in map units. */
export type MapLandmark = {
  key: string;
  name: string;
  style: LandmarkStyle;
  center: [number, number];
  tile: { x: number; y: number };
};

/** A match zone: disc centre/radius in units, spawn nodes, landmark keys inside it. */
export type MapZone = {
  key: ZoneKey;
  name: string;
  center: [number, number];
  radius: number;
  spawnNodes: [number, number][];
  landmarks: string[];
};

/** `index.json` — everything the runtime needs before loading tiles. */
export type MapIndex = {
  version: 1;
  generatedAt: string;
  origin: { lat: number; lon: number };
  unitsPerMetre: number;
  bounds: MapBounds;
  tileSize: number;
  tiles: MapTileRef[];
  zones: MapZone[];
  landmarks: MapLandmark[];
};

/**
 * `roads.json` — the drivable road graph. `nodes` is a flat `[x0, y0, x1, y1, …]` array in
 * units; `edges` is flat with {@link ROAD_EDGE_STRIDE} numbers per edge; `classes` and `names`
 * are lookup tables referenced by index (nameIndex −1 = unnamed).
 */
export type MapRoads = {
  nodes: number[];
  edges: number[];
  classes: RoadClass[];
  names: string[];
};

/** Road centre line inside a tile, flat `[x0, y0, …]` units. */
export type TileRoad = {
  points: number[];
  roadClass: RoadClass;
  name?: string;
};

/** Building footprint (outer ring, flat units, first point not repeated). */
export type TileBuilding = {
  points: number[];
  levels: number;
  landmark?: string;
};

/** Ground polygon with its fill kind. */
export type TileGround = { points: number[]; kind: GroundKind };

/** Water polygon. */
export type TileWater = { points: number[] };

/** `tile_x_y.json` — all static geometry inside one 2 km tile (plus 20 m overlap). */
export type MapTile = {
  x: number;
  y: number;
  roads: TileRoad[];
  buildings: TileBuilding[];
  ground: TileGround[];
  water: TileWater[];
};
