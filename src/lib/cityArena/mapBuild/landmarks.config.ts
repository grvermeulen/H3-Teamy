import type { LandmarkStyle, ZoneKey } from "../world/mapTypes";
import type { LatLon, OsmTags } from "./osmTypes";

/**
 * One recognisable place. `nameMatch` is a case-insensitive substring of the OSM `name`;
 * `matchesTags` narrows by tags; `near` restricts to a disc; `osmId` ("way/123") pins an exact
 * element when the build reports ambiguity. Exactly one element must match.
 */
export type LandmarkConfig = {
  key: string;
  name: string;
  nameMatch: string;
  style: LandmarkStyle;
  matchesTags: (tags: OsmTags) => boolean;
  zoneAnchor?: ZoneKey;
  near?: LatLon & { radiusM: number };
  osmId?: string;
};

const isPlaceOfWorship = (tags: OsmTags): boolean =>
  tags.amenity === "place_of_worship" || tags.building === "church";
const isPool = (tags: OsmTags): boolean =>
  tags.leisure === "sports_centre" || tags.leisure === "swimming_pool";
const isUniversity = (tags: OsmTags): boolean =>
  tags.amenity === "university" || tags.building === "university";
const isCafe = (tags: OsmTags): boolean =>
  ["cafe", "bar", "pub", "restaurant"].includes(tags.amenity ?? "");

const WAGENINGEN_MARKT: LatLon = { lat: 51.9693, lon: 5.6656 };
const BENNEKOM_DORPSSTRAAT: LatLon = { lat: 51.9993, lon: 5.676 };

/** The landmark table from the design spec §3.2. */
export const LANDMARKS: LandmarkConfig[] = [
  {
    key: "cunerakerk",
    name: "Cunerakerk",
    nameMatch: "Cunera",
    style: "church",
    matchesTags: isPlaceOfWorship,
    zoneAnchor: "rhenen",
  },
  {
    key: "gastland",
    name: "Zwembad 't Gastland",
    nameMatch: "Gastland",
    style: "pool",
    matchesTags: isPool,
  },
  {
    key: "grote-kerk-wageningen",
    name: "Grote Kerk",
    nameMatch: "Grote Kerk",
    style: "church",
    matchesTags: isPlaceOfWorship,
    zoneAnchor: "wageningen",
    near: { ...WAGENINGEN_MARKT, radiusM: 800 },
  },
  {
    key: "onder-de-linden",
    name: "Café Onder de Linden",
    nameMatch: "Onder de Linden",
    style: "cafe",
    matchesTags: isCafe,
  },
  {
    key: "de-bongerd",
    name: "Zwembad De Bongerd",
    nameMatch: "Bongerd",
    style: "pool",
    matchesTags: isPool,
  },
  {
    key: "wur-forum",
    name: "WUR Forum",
    nameMatch: "Forum",
    style: "campus",
    matchesTags: isUniversity,
    zoneAnchor: "campus",
  },
  {
    key: "wur-orion",
    name: "WUR Orion",
    nameMatch: "Orion",
    style: "campus",
    matchesTags: isUniversity,
  },
  {
    key: "wur-atlas",
    name: "WUR Atlas",
    nameMatch: "Atlas",
    style: "campus",
    matchesTags: isUniversity,
  },
  {
    key: "oude-kerk-bennekom",
    name: "Oude Kerk",
    nameMatch: "Oude Kerk",
    style: "church",
    matchesTags: isPlaceOfWorship,
    zoneAnchor: "bennekom",
    near: { ...BENNEKOM_DORPSSTRAAT, radiusM: 800 },
  },
  {
    key: "vrije-slag",
    name: "Zwembad De Vrije Slag",
    nameMatch: "Vrije Slag",
    style: "pool",
    matchesTags: isPool,
  },
];
