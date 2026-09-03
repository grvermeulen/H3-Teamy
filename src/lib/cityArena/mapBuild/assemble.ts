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
import { osmElementId, type LatLon, type OverpassJson } from "./osmTypes";
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
};

/**
 * Buildings smaller than this are dropped (sheds, garages). Raised from 30 during the
 * real build (decision rule, brief step 1) to help stay inside the 900 KB gzip budget —
 * see spec §3.1.
 */
export const MIN_BUILDING_AREA_M2 = 40;

/**
 * Non-landmark buildings are kept only within this distance of a zone centre. The real
 * build exceeded the 900 KB gzip budget even with `MIN_BUILDING_AREA_M2 = 40` and this at
 * the brief's prescribed 1200 (radius all the way down to 10 — i.e. almost no non-landmark
 * buildings anywhere — still left the asset at 939.7 KB, because ground/water polygons and
 * per-tile road rendering, not buildings, turned out to dominate this region's real OSM
 * data). Lowered further to 1000 alongside `RING_SIMPLIFY_TOLERANCE_M` below; still ≥ the
 * 500 m zone radius, so the whole playable disc keeps building detail. See spec §3.1.
 */
export const BUILDING_KEEP_RADIUS_M = 1000;

/** A landmark point attaches to the building containing it or within this distance. */
export const LANDMARK_ATTACH_DISTANCE_M = 15;

/** `building:levels` fallback. */
export const DEFAULT_BUILDING_LEVELS = 2;

/**
 * Douglas-Peucker tolerance for every polygon/polyline ring (buildings, ground, water).
 * Raised from 0.5 during the real build: ground polygons (farmland/forest/grass over the
 * whole ~10 km bbox, unfiltered by zone proximity by design — spec §3.1) were ~68 % of
 * total tile bytes and the actual dominant gzip-budget cost, not buildings. 4 m is coarse
 * only for background terrain outlines, not buildings' collision-relevant footprints
 * (small polygons lose few vertices at this tolerance) — see spec §3.1.
 */
const RING_SIMPLIFY_TOLERANCE_M = 4;

type StyledLandmark = ProjectedLandmark & {
  name: string;
  style: MapLandmark["style"];
};

function ringToMetres(ring: LatLon[]): Point[] {
  return simplifyRing(
    ring.map((coordinate) => projectLonLat(coordinate.lon, coordinate.lat)),
    RING_SIMPLIFY_TOLERANCE_M,
  );
}

function levelsOf(tags: Record<string, string>): number {
  const parsed = Number.parseInt(tags["building:levels"] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_BUILDING_LEVELS;
}

function projectBuildings(
  features: AreaFeature[],
  zoneCentres: Point[],
  landmarkElementIds: Set<string>,
): ProjectedBuilding[] {
  const buildings: ProjectedBuilding[] = [];
  for (const feature of features) {
    const ring = ringToMetres(feature.ring);
    if (ring.length < 3) continue;
    const isLandmark = landmarkElementIds.has(feature.id.split("#")[0]);
    if (!isLandmark) {
      if (polygonArea(ring) < MIN_BUILDING_AREA_M2) continue;
      const centroid = polygonCentroid(ring);
      const nearZone = zoneCentres.some(
        (centre) => distance(centroid, centre) <= BUILDING_KEEP_RADIUS_M,
      );
      if (!nearZone) continue;
    }
    buildings.push({ ring, levels: levelsOf(feature.tags) });
  }
  return buildings;
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
  }));
  const landmarkElementIds = new Set(
    match.matched.map((matched) => osmElementId(matched.element)),
  );
  const zoneCentres = zoneCentresFromLandmarks(landmarks);

  const areas = extractAreas(input.areasOsm);
  const buildingAreas = extractAreas(input.buildingsOsm);
  const buildings = projectBuildings(
    buildingAreas.buildings,
    zoneCentres.map((zone) => zone.center),
    landmarkElementIds,
  );
  attachLandmarks(buildings, landmarks);
  const water: ProjectedWater[] = areas.water
    .map((feature) => ({ ring: ringToMetres(feature.ring) }))
    .filter((feature) => feature.ring.length >= 3);
  const ground: ProjectedGround[] = areas.ground
    .map((feature) => ({
      ring: ringToMetres(feature.ring),
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
    indexObstacles(buildings.map((building) => building.ring)),
    indexObstacles(water.map((feature) => feature.ring)),
  );

  const bounds = regionBoundsMetres();
  const tiles = buildTiles(
    bounds,
    renderRoads(ways, nodeCoords),
    buildings,
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
  return { index, roads, tiles };
}
