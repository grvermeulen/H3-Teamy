import osm2geojson from "osm2geojson-lite";
import type { GroundKind } from "../world/mapTypes";
import type { LatLon, OsmTags, OverpassJson } from "./osmTypes";

/** A polygon feature reduced to its outer ring (closing point removed) and its tags. */
export type AreaFeature = { id: string; tags: OsmTags; ring: LatLon[] };

/** Ground polygon with a non-default fill kind. */
export type GroundArea = AreaFeature & { kind: Exclude<GroundKind, "urban"> };

/** Buildings, water and ground polygons extracted from one Overpass response. */
export type ExtractedAreas = {
  buildings: AreaFeature[];
  water: AreaFeature[];
  ground: GroundArea[];
};

type GeoFeature = ReturnType<typeof osm2geojson>["features"][number];

/** Land-use → ground kind; `null` for the implicit `urban` default and unrelated tags. */
export function groundKindOf(
  tags: OsmTags,
): Exclude<GroundKind, "urban"> | null {
  if (
    tags.landuse === "grass" ||
    tags.leisure === "park" ||
    tags.leisure === "pitch"
  )
    return "grass";
  if (tags.landuse === "farmland" || tags.landuse === "meadow") return "field";
  if (
    tags.landuse === "forest" ||
    tags.natural === "wood" ||
    tags.natural === "scrub"
  )
    return "forest";
  return null;
}

function tagsFromProperties(properties: unknown): OsmTags {
  const tags: OsmTags = {};
  if (typeof properties !== "object" || properties === null) return tags;
  for (const [key, value] of Object.entries(properties)) {
    if (key === "id") continue;
    if (typeof value === "string") tags[key] = value;
  }
  return tags;
}

function ringFromPositions(positions: number[][]): LatLon[] {
  const ring: LatLon[] = positions.map(([lon, lat]) => ({ lat, lon }));
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first.lat === last.lat && first.lon === last.lon)
    ring.pop();
  return ring;
}

function outerRings(feature: GeoFeature): number[][][] {
  const geometry = feature.geometry;
  if (geometry.type === "Polygon") return [geometry.coordinates[0]];
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates.map((polygon) => polygon[0]);
  return [];
}

/** Converts an Overpass response to classified outer-ring polygons. */
export function extractAreas(json: OverpassJson): ExtractedAreas {
  const collection = osm2geojson(json, {
    completeFeature: true,
    renderTagged: true,
    excludeWay: true,
  });
  const areas: ExtractedAreas = { buildings: [], water: [], ground: [] };
  for (const feature of collection.features) {
    const rings = outerRings(feature);
    if (rings.length === 0) continue;
    const tags = tagsFromProperties(feature.properties);
    const baseId =
      typeof feature.id === "string"
        ? feature.id
        : String(feature.id ?? "unknown");
    rings.forEach((positions, index) => {
      const ring = ringFromPositions(positions);
      if (ring.length < 3) return;
      const id = rings.length === 1 ? baseId : `${baseId}#${index}`;
      const area: AreaFeature = { id, tags, ring };
      if (tags.building && tags.building !== "no") {
        areas.buildings.push(area);
        return;
      }
      if (
        tags.natural === "water" ||
        tags.landuse === "reservoir" ||
        tags.landuse === "basin"
      ) {
        areas.water.push(area);
        return;
      }
      const kind = groundKindOf(tags);
      if (kind) areas.ground.push({ ...area, kind });
    });
  }
  return areas;
}
