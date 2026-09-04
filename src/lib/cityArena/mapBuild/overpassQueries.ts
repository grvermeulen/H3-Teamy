import { MAP_BBOX } from "../world/projection";
import type { LatLon } from "./osmTypes";

/** Overpass bbox filter argument: south,west,north,east. */
export const OVERPASS_BBOX = `${MAP_BBOX.south},${MAP_BBOX.west},${MAP_BBOX.north},${MAP_BBOX.east}`;

/** Highway classes the game treats as drivable (cycle and foot paths are excluded). */
export const DRIVABLE_HIGHWAY_REGEX =
  "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$";

/** Buildings are fetched within this radius of each zone centre. */
export const BUILDING_RADIUS_M = 1500;

/** Service roads (parking access) are fetched within this radius of each zone centre. */
export const SERVICE_ROAD_RADIUS_M = 500;

const HEADER = "[out:json][timeout:300];";
const OUTPUT = "out body;\n>;\nout skel qt;";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");
}

function aroundClause(radiusMetres: number, centre: LatLon): string {
  return `(around:${radiusMetres},${centre.lat},${centre.lon})`;
}

function wrapUnion(statements: string[]): string {
  return `${HEADER}\n(\n${statements.map((statement) => `  ${statement}`).join("\n")}\n);\n${OUTPUT}\n`;
}

/** Everything in the bbox whose name contains one of the given fragments (case-insensitive). */
export function buildLandmarkQuery(nameMatches: string[]): string {
  return wrapUnion(
    nameMatches.map(
      (fragment) =>
        `nwr["name"~"${escapeRegex(fragment)}",i](${OVERPASS_BBOX});`,
    ),
  );
}

/** Drivable roads in the bbox plus service roads near each zone centre. */
export function buildRoadsQuery(serviceCentres: LatLon[]): string {
  return wrapUnion([
    `way["highway"~"${DRIVABLE_HIGHWAY_REGEX}"](${OVERPASS_BBOX});`,
    ...serviceCentres.map(
      (centre) =>
        `way["highway"="service"]${aroundClause(SERVICE_ROAD_RADIUS_M, centre)};`,
    ),
  ]);
}

/** Water and ground polygons for the whole bbox. */
export function buildAreasQuery(): string {
  return wrapUnion([
    `nwr["natural"="water"](${OVERPASS_BBOX});`,
    `nwr["landuse"~"^(reservoir|basin)$"](${OVERPASS_BBOX});`,
    `nwr["landuse"~"^(grass|meadow|farmland|forest)$"](${OVERPASS_BBOX});`,
    `nwr["leisure"~"^(park|pitch)$"](${OVERPASS_BBOX});`,
    `nwr["natural"~"^(wood|scrub)$"](${OVERPASS_BBOX});`,
  ]);
}

/** Buildings near each zone centre plus explicitly listed landmark ways/relations. */
export function buildBuildingsQuery(
  centres: LatLon[],
  extraElementIds: string[],
): string {
  const wayIds: number[] = [];
  const relationIds: number[] = [];
  for (const elementId of extraElementIds) {
    const [type, rawId] = elementId.split("/");
    const id = Number(rawId);
    if (type === "way") wayIds.push(id);
    if (type === "relation") relationIds.push(id);
  }
  const statements = centres.map(
    (centre) => `nwr["building"]${aroundClause(BUILDING_RADIUS_M, centre)};`,
  );
  if (wayIds.length > 0) statements.push(`way(id:${wayIds.join(",")});`);
  if (relationIds.length > 0)
    statements.push(`relation(id:${relationIds.join(",")});`);
  return wrapUnion(statements);
}
