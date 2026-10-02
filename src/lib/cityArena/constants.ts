import type { ZoneKey } from "./world/mapTypes";

/**
 * Version segment of the committed map asset path; bump when regenerating the map, because the
 * tiles are served immutable (v2: trees and street furniture, Plan 9b, 2026-09-10; v3: the
 * brewery landmark at Cuneralaan 42, 2026-09-12).
 */
export const MAP_VERSION = "v3";

/** Public URL prefix of the map asset (served from `public/`). */
export const MAP_BASE_PATH = `/arena/map/${MAP_VERSION}`;

/** Match zones offered on the launcher card, in the same order and with the same names as `index.json`. */
export const ZONE_OPTIONS: { key: ZoneKey; name: string }[] = [
  { key: "rhenen", name: "Rhenen centrum" },
  { key: "wageningen", name: "Wageningen centrum" },
  { key: "campus", name: "WUR-campus" },
  { key: "bennekom", name: "Bennekom" },
];
