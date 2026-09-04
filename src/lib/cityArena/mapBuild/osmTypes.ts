/** Free-form OSM tag map. */
export type OsmTags = Record<string, string>;

/** A geographic coordinate in degrees. */
export type LatLon = { lat: number; lon: number };

/** Overpass `node` element (coordinates present with `out body`/`out skel`). */
export type OverpassNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: OsmTags;
};

/** Overpass `way` element: ordered node ids. */
export type OverpassWay = {
  type: "way";
  id: number;
  nodes: number[];
  tags?: OsmTags;
};

/** Member of a relation. */
export type OverpassRelationMember = {
  type: "node" | "way" | "relation";
  ref: number;
  role: string;
};

/** Overpass `relation` element (multipolygons, etc.). */
export type OverpassRelation = {
  type: "relation";
  id: number;
  members: OverpassRelationMember[];
  tags?: OsmTags;
};

/** Any Overpass element. */
export type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

/** Top-level Overpass JSON response. */
export type OverpassJson = {
  version?: number;
  generator?: string;
  elements: OverpassElement[];
};

/** Indexes nodes by id for coordinate lookups. */
export function indexNodes(json: OverpassJson): Map<number, OverpassNode> {
  const nodes = new Map<number, OverpassNode>();
  for (const element of json.elements) {
    if (element.type === "node") nodes.set(element.id, element);
  }
  return nodes;
}

/** Indexes ways by id for relation member lookups. */
export function indexWays(json: OverpassJson): Map<number, OverpassWay> {
  const ways = new Map<number, OverpassWay>();
  for (const element of json.elements) {
    if (element.type === "way") ways.set(element.id, element);
  }
  return ways;
}

/** Canonical `"type/id"` string, matching osm2geojson-lite feature ids. */
export function osmElementId(element: OverpassElement): string {
  return `${element.type}/${element.id}`;
}
