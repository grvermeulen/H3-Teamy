import {
  MAP_UNITS_PER_METRE,
  type MapIndex,
  type MapLandmark,
  type MapRoads,
  type MapTile,
} from "../world/mapTypes";
import {
  MAP_ORIGIN,
  projectLonLat,
  toUnits,
  type Point,
} from "../world/projection";
import { extractAreas, type AreaFeature } from "./areas";
import { MapBuildError } from "./errors";
import {
  distance,
  distancePointToPolygon,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  simplifyRing,
} from "./geometry";
import type { LandmarkConfig } from "./landmarks.config";
import { matchLandmarks } from "./landmarks";
import type { LatLon, OverpassJson } from "./osmTypes";
import {
  buildRoadGraph,
  encodeRoads,
  parseRoadWays,
  projectNodeCoordinates,
  renderRoads,
} from "./roads";
import {
  TILE_SIZE_M,
  boundsToUnits,
  buildTiles,
  regionBoundsMetres,
  tileCoordFor,
  tileFileName,
  type ProjectedBuilding,
  type ProjectedGround,
  type ProjectedWater,
} from "./tiles";
import {
  buildZones,
  indexObstacles,
  zoneCentresFromLandmarks,
  type ProjectedLandmark,
} from "./zones";

/** Overpass responses for the four query stages plus configuration. */
export type AssembleInput = {
  landmarkOsm: OverpassJson;
  roadsOsm: OverpassJson;
  areasOsm: OverpassJson;
  buildingsOsm: OverpassJson;
  config: LandmarkConfig[];
  generatedAt: string;
};

/** Everything the writer needs; `index.tiles[].bytes` is filled in by the writer. */
export type AssembledMap = {
  index: MapIndex;
  roads: MapRoads;
  tiles: MapTile[];
  /** Landmark keys with no building after attachment and footprint synthesis — rendered
   * as labels only (spec §3.2). */
  unattachedLandmarks: string[];
};

/**
 * Buildings smaller than this are dropped (sheds, garages). Raised from 30 during the
 * real build to fit the map budget (1.2 MB total, 256 KB per tile, gzipped) — see spec
 * §3.4.
 */
export const MIN_BUILDING_AREA_M2 = 40;

/**
 * Non-landmark buildings are kept only within this distance of a zone centre. The brief's
 * original value; owner decision 2026-09-04 raised the gzip budget (see
 * `GZIP_BUDGET_BYTES`/`TILE_GZIP_BUDGET_BYTES` in `scripts/arena/buildMap.ts`) instead of
 * shrinking this further — see spec §3.1/§3.4.
 */
export const BUILDING_KEEP_RADIUS_M = 1200;

/** A landmark point attaches to the building containing it or within this distance. */
export const LANDMARK_ATTACH_DISTANCE_M = 15;

/** `building:levels` fallback. */
export const DEFAULT_BUILDING_LEVELS = 2;

/**
 * Douglas-Peucker tolerance for building footprint rings. Kept fine: a coarser tolerance
 * collapses small footprints (a 6×5 m outbuilding can lose a vertex; L-shaped notches
 * under the tolerance vanish), and building outlines are collision-relevant, not just
 * decorative — see spec §3.3.
 */
export const BUILDING_SIMPLIFY_TOLERANCE_M = 0.5;

/**
 * Douglas-Peucker tolerance for ground and water rings — background terrain outlines
 * only, never used for buildings. Raised from 0.5 during the real build: ground polygons
 * (farmland/forest/grass over the whole ~10 km bbox, unfiltered by zone proximity by
 * design — spec §3.1) were ~68 % of total tile bytes and the actual dominant gzip-budget
 * cost, not buildings — see spec §3.1 and §3.3.
 */
export const TERRAIN_SIMPLIFY_TOLERANCE_M = 4;

type StyledLandmark = ProjectedLandmark & {
  name: string;
  style: MapLandmark["style"];
  footprint: LatLon[] | null;
};

function ringToMetres(ring: LatLon[], toleranceMetres: number): Point[] {
  return simplifyRing(
    ring.map((coordinate) => projectLonLat(coordinate.lon, coordinate.lat)),
    toleranceMetres,
  );
}

function levelsOf(tags: Record<string, string>): number {
  const parsed = Number.parseInt(tags["building:levels"] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_BUILDING_LEVELS;
}

/** Projects every building ring to metres with its levels; nothing is filtered out yet — see
 * {@link keepBuilding} — so landmark attachment (finding 2) sees every candidate building. */
function projectBuildingRings(features: AreaFeature[]): ProjectedBuilding[] {
  const buildings: ProjectedBuilding[] = [];
  for (const feature of features) {
    const ring = ringToMetres(feature.ring, BUILDING_SIMPLIFY_TOLERANCE_M);
    if (ring.length < 3) continue;
    buildings.push({ ring, levels: levelsOf(feature.tags) });
  }
  return buildings;
}

/**
 * Whether a building survives the area/keep-radius filter. A building a landmark has
 * attached to (by proximity, or a synthesised footprint) is always kept, regardless of
 * size or distance — see finding 2/3.
 */
function keepBuilding(
  building: ProjectedBuilding,
  zoneCentres: Point[],
): boolean {
  if (building.landmark) return true;
  if (polygonArea(building.ring) < MIN_BUILDING_AREA_M2) return false;
  const centroid = polygonCentroid(building.ring);
  return zoneCentres.some(
    (centre) => distance(centroid, centre) <= BUILDING_KEEP_RADIUS_M,
  );
}

/** Landmark keys already carried by some building's `landmark` field. */
function attachedLandmarkKeys(buildings: ProjectedBuilding[]): Set<string> {
  const keys = new Set<string>();
  for (const building of buildings) {
    if (building.landmark) keys.add(building.landmark);
  }
  return keys;
}

/**
 * Landmarks still without a building after {@link attachLandmarks} get their own footprint
 * as a one-level building (spec §3.2), when their matched element is a closed way or a
 * multipolygon relation. Node landmarks, and landmarks whose element isn't closed, are left
 * for {@link unattachedLandmarkKeys} to report.
 */
function attachFootprintLandmarks(
  buildings: ProjectedBuilding[],
  landmarks: StyledLandmark[],
): void {
  const attached = attachedLandmarkKeys(buildings);
  for (const landmark of landmarks) {
    if (attached.has(landmark.key) || !landmark.footprint) continue;
    const ring = ringToMetres(
      landmark.footprint,
      BUILDING_SIMPLIFY_TOLERANCE_M,
    );
    if (ring.length < 3) continue;
    buildings.push({ ring, levels: 1, landmark: landmark.key });
  }
}

/** Landmark keys with no building even after footprint synthesis — labels only. */
function unattachedLandmarkKeys(
  buildings: ProjectedBuilding[],
  landmarks: StyledLandmark[],
): string[] {
  const attached = attachedLandmarkKeys(buildings);
  return landmarks
    .filter((landmark) => !attached.has(landmark.key))
    .map((landmark) => landmark.key);
}

/** A zone-anchor landmark with no building at all is a hard build error: the zone would
 * have no visible anchor to orient players. */
function assertZoneAnchorsAttached(
  landmarks: StyledLandmark[],
  unattachedLandmarks: string[],
): void {
  const missingAnchor = landmarks.find(
    (landmark) =>
      landmark.zoneAnchor && unattachedLandmarks.includes(landmark.key),
  );
  if (missingAnchor) {
    throw new MapBuildError(
      `Zone anchor landmark "${missingAnchor.key}" has no building`,
    );
  }
}

function attachLandmarks(
  buildings: ProjectedBuilding[],
  landmarks: StyledLandmark[],
): void {
  for (const landmark of landmarks) {
    let best: ProjectedBuilding | null = null;
    let bestDistance = Infinity;
    for (const building of buildings) {
      if (building.landmark) continue;
      const separation = pointInPolygon(landmark.center, building.ring)
        ? 0
        : distancePointToPolygon(landmark.center, building.ring);
      if (separation < bestDistance) {
        bestDistance = separation;
        best = building;
      }
    }
    if (best && bestDistance <= LANDMARK_ATTACH_DISTANCE_M)
      best.landmark = landmark.key;
  }
}

/** Pure end-to-end transform from Overpass responses to the asset structures. */
export function assembleMap(input: AssembleInput): AssembledMap {
  const match = matchLandmarks(input.landmarkOsm, input.config);
  if (match.errors.length > 0) throw new MapBuildError(match.errors.join("\n"));

  const landmarks: StyledLandmark[] = match.matched.map((matched) => ({
    key: matched.config.key,
    name: matched.config.name,
    style: matched.config.style,
    center: projectLonLat(matched.center.lon, matched.center.lat),
    zoneAnchor: matched.config.zoneAnchor,
    footprint: matched.footprint,
  }));
  const zoneCentres = zoneCentresFromLandmarks(landmarks);

  const areas = extractAreas(input.areasOsm);
  const buildingAreas = extractAreas(input.buildingsOsm);
  const buildings = projectBuildingRings(buildingAreas.buildings);
  attachLandmarks(buildings, landmarks);
  attachFootprintLandmarks(buildings, landmarks);
  const unattachedLandmarks = unattachedLandmarkKeys(buildings, landmarks);
  assertZoneAnchorsAttached(landmarks, unattachedLandmarks);
  const zoneCentrePoints = zoneCentres.map((zone) => zone.center);
  const keptBuildings = buildings.filter((building) =>
    keepBuilding(building, zoneCentrePoints),
  );

  const water: ProjectedWater[] = areas.water
    .map((feature) => ({
      ring: ringToMetres(feature.ring, TERRAIN_SIMPLIFY_TOLERANCE_M),
    }))
    .filter((feature) => feature.ring.length >= 3);
  const ground: ProjectedGround[] = areas.ground
    .map((feature) => ({
      ring: ringToMetres(feature.ring, TERRAIN_SIMPLIFY_TOLERANCE_M),
      kind: feature.kind,
    }))
    .filter((feature) => feature.ring.length >= 3);

  const ways = parseRoadWays(input.roadsOsm);
  const nodeCoords = projectNodeCoordinates(input.roadsOsm);
  const graph = buildRoadGraph(ways, nodeCoords);
  const roads = encodeRoads(graph);

  const zones = buildZones(
    zoneCentres,
    graph,
    landmarks,
    indexObstacles(keptBuildings.map((building) => building.ring)),
    indexObstacles(water.map((feature) => feature.ring)),
  );

  const bounds = regionBoundsMetres();
  const tiles = buildTiles(
    bounds,
    renderRoads(ways, nodeCoords),
    keptBuildings,
    ground,
    water,
  );

  const index: MapIndex = {
    version: 1,
    generatedAt: input.generatedAt,
    origin: { lat: MAP_ORIGIN.lat, lon: MAP_ORIGIN.lon },
    unitsPerMetre: MAP_UNITS_PER_METRE,
    bounds: boundsToUnits(bounds),
    tileSize: toUnits(TILE_SIZE_M),
    tiles: tiles.map((tile) => ({
      x: tile.x,
      y: tile.y,
      file: tileFileName(tile),
      bytes: 0,
    })),
    zones,
    landmarks: landmarks.map((landmark) => ({
      key: landmark.key,
      name: landmark.name,
      style: landmark.style,
      center: [toUnits(landmark.center[0]), toUnits(landmark.center[1])],
      tile: tileCoordFor(landmark.center, bounds),
    })),
  };
  return { index, roads, tiles, unattachedLandmarks };
}
