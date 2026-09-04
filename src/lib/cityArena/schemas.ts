import { z } from "zod";
import type { MapIndex, MapRoads, MapTile, ZoneKey } from "./world/mapTypes";

const zoneKeys = ["rhenen", "wageningen", "campus", "bennekom"] as const;
const unitPoint = z.tuple([z.number().int(), z.number().int()]);

/** Zod schema for `index.json`; runtime validation happens once per session. */
export const MapIndexSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  origin: z.object({ lat: z.number(), lon: z.number() }),
  unitsPerMetre: z.literal(4),
  bounds: z.object({
    minX: z.number(),
    minY: z.number(),
    maxX: z.number(),
    maxY: z.number(),
  }),
  tileSize: z.number().int().positive(),
  tiles: z.array(
    z.object({
      x: z.number().int(),
      y: z.number().int(),
      file: z.string(),
      bytes: z.number().int(),
    }),
  ),
  zones: z.array(
    z.object({
      key: z.enum(zoneKeys),
      name: z.string(),
      center: unitPoint,
      radius: z.number().int().positive(),
      spawnNodes: z.array(unitPoint),
      landmarks: z.array(z.string()),
    }),
  ),
  landmarks: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      style: z.enum(["church", "pool", "campus", "cafe"]),
      center: unitPoint,
      tile: z.object({ x: z.number().int(), y: z.number().int() }),
    }),
  ),
});

/** Parses and validates an `index.json` payload; throws a ZodError on mismatch. */
export function parseMapIndex(value: unknown): MapIndex {
  return MapIndexSchema.parse(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFlatNumberArray(value: unknown): boolean {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "number")
  );
}

function isGeometryList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((entry) => isRecord(entry) && isFlatNumberArray(entry.points))
  );
}

function isStringArray(value: unknown): boolean {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

/** Cheap structural guard for a tile payload (full Zod validation would be too slow at 10 Hz loads). */
export function isMapTile(value: unknown): value is MapTile {
  if (!isRecord(value)) return false;
  return (
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    isGeometryList(value.roads) &&
    isGeometryList(value.buildings) &&
    isGeometryList(value.ground) &&
    isGeometryList(value.water)
  );
}

/** Cheap structural guard for `roads.json` (full Zod validation of the 180 KB flat-array payload would cost more than it protects). */
export function isMapRoads(value: unknown): value is MapRoads {
  if (!isRecord(value)) return false;
  return (
    isFlatNumberArray(value.nodes) &&
    isFlatNumberArray(value.edges) &&
    isStringArray(value.classes) &&
    isStringArray(value.names)
  );
}

/** Persisted player preferences (extended by later plans). */
export const ArenaSettingsSchema = z.object({
  lastZone: z.enum(zoneKeys).default("wageningen"),
});

/** Parsed settings type. */
export type ArenaSettings = { lastZone: ZoneKey };

/** Defaults used when nothing valid is stored. */
export const DEFAULT_ARENA_SETTINGS: ArenaSettings = { lastZone: "wageningen" };
