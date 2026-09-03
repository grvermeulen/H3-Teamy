import type { LandmarkConfig } from "../landmarks.config";
import type { OsmTags, OverpassElement, OverpassJson } from "../osmTypes";

const DEGREES_PER_METRE_LAT = 1 / 110_574;
const DEGREES_PER_METRE_LON = 1 / (111_320 * Math.cos((51.98 * Math.PI) / 180));

/** A closed square way of `sideMetres` centred on (lat, lon); node ids are `wayId * 10 + n`. */
export function squareWay(
  wayId: number,
  lat: number,
  lon: number,
  sideMetres: number,
  tags?: OsmTags,
): OverpassElement[] {
  const halfLat = (sideMetres / 2) * DEGREES_PER_METRE_LAT;
  const halfLon = (sideMetres / 2) * DEGREES_PER_METRE_LON;
  const base = wayId * 10;
  const way: OverpassElement = {
    type: "way",
    id: wayId,
    nodes: [base + 1, base + 2, base + 3, base + 4, base + 1],
    ...(tags ? { tags } : {}),
  };
  return [
    { type: "node", id: base + 1, lat: lat - halfLat, lon: lon - halfLon },
    { type: "node", id: base + 2, lat: lat - halfLat, lon: lon + halfLon },
    { type: "node", id: base + 3, lat: lat + halfLat, lon: lon + halfLon },
    { type: "node", id: base + 4, lat: lat + halfLat, lon: lon - halfLon },
    way,
  ];
}

/** A road of consecutive nodes offset east of (lat, lon) by `spacingMetres` each. */
export function roadWay(
  wayId: number,
  lat: number,
  lon: number,
  nodeCount: number,
  spacingMetres: number,
  tags: OsmTags,
): OverpassElement[] {
  const base = wayId * 10;
  const nodes: OverpassElement[] = [];
  const ids: number[] = [];
  for (let index = 0; index < nodeCount; index++) {
    ids.push(base + index);
    nodes.push({
      type: "node",
      id: base + index,
      lat,
      lon: lon + index * spacingMetres * DEGREES_PER_METRE_LON,
    });
  }
  return [...nodes, { type: "way", id: wayId, nodes: ids, tags }];
}

const RHENEN = { lat: 51.958, lon: 5.569 };
const WAGENINGEN = { lat: 51.9693, lon: 5.6656 };
const CAMPUS = { lat: 51.9855, lon: 5.664 };
const BENNEKOM = { lat: 51.9993, lon: 5.676 };

/**
 * One payload that serves every build stage: four anchor buildings, a café inside a building,
 * one short road per zone, a shed (too small), a far building (outside 1.5 km), water and farmland.
 */
export const overpassMini: OverpassJson = {
  elements: [
    ...squareWay(1, RHENEN.lat, RHENEN.lon, 30, {
      amenity: "place_of_worship",
      building: "church",
      name: "Cunerakerk",
      "building:levels": "4",
    }),
    ...squareWay(2, WAGENINGEN.lat, WAGENINGEN.lon, 30, {
      amenity: "place_of_worship",
      building: "church",
      name: "Grote Kerk",
    }),
    ...squareWay(3, CAMPUS.lat, CAMPUS.lon, 40, {
      amenity: "university",
      building: "yes",
      name: "Forum",
    }),
    ...squareWay(4, BENNEKOM.lat, BENNEKOM.lon, 30, {
      amenity: "place_of_worship",
      building: "church",
      name: "Oude Kerk",
    }),
    ...squareWay(5, WAGENINGEN.lat + 0.001, WAGENINGEN.lon, 20, {
      building: "yes",
    }),
    {
      type: "node",
      id: 500,
      lat: WAGENINGEN.lat + 0.001,
      lon: WAGENINGEN.lon,
      tags: { amenity: "cafe", name: "Café Onder de Linden" },
    },
    ...squareWay(6, WAGENINGEN.lat, WAGENINGEN.lon + 0.002, 4, {
      building: "shed",
    }),
    ...squareWay(7, 51.945, 5.6, 20, { building: "yes", name: "Ver weg" }),
    ...roadWay(11, RHENEN.lat + 0.0005, RHENEN.lon, 3, 40, {
      highway: "residential",
      name: "Herenstraat",
    }),
    ...roadWay(12, WAGENINGEN.lat + 0.0005, WAGENINGEN.lon, 3, 40, {
      highway: "residential",
      name: "Dorpsstraat",
    }),
    ...roadWay(13, CAMPUS.lat + 0.0005, CAMPUS.lon, 3, 40, {
      highway: "tertiary",
      name: "Droevendaalsesteeg",
    }),
    ...roadWay(14, BENNEKOM.lat + 0.0005, BENNEKOM.lon, 3, 40, {
      highway: "residential",
      name: "Dorpsstraat",
    }),
    ...squareWay(20, 51.95, 5.62, 200, { natural: "water", name: "Plas" }),
    ...squareWay(21, 51.99, 5.6, 300, { landuse: "farmland" }),
  ],
};

/** Landmark subset matching the fixture (the four anchors plus the café). */
export const MINI_LANDMARKS: LandmarkConfig[] = [
  {
    key: "cunerakerk",
    name: "Cunerakerk",
    nameMatch: "Cunera",
    style: "church",
    matchesTags: (tags) => tags.amenity === "place_of_worship",
    zoneAnchor: "rhenen",
  },
  {
    key: "grote-kerk-wageningen",
    name: "Grote Kerk",
    nameMatch: "Grote Kerk",
    style: "church",
    matchesTags: (tags) => tags.amenity === "place_of_worship",
    zoneAnchor: "wageningen",
  },
  {
    key: "wur-forum",
    name: "WUR Forum",
    nameMatch: "Forum",
    style: "campus",
    matchesTags: (tags) => tags.amenity === "university",
    zoneAnchor: "campus",
  },
  {
    key: "oude-kerk-bennekom",
    name: "Oude Kerk",
    nameMatch: "Oude Kerk",
    style: "church",
    matchesTags: (tags) => tags.amenity === "place_of_worship",
    zoneAnchor: "bennekom",
  },
  {
    key: "onder-de-linden",
    name: "Café Onder de Linden",
    nameMatch: "Onder de Linden",
    style: "cafe",
    matchesTags: (tags) => tags.amenity === "cafe",
  },
];
