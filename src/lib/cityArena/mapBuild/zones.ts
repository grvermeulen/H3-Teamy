import type { MapZone, ZoneKey } from "../world/mapTypes";
import { toUnits, type Point } from "../world/projection";
import { MapBuildError } from "./errors";
import {
  boundsOf,
  distance,
  distancePointToPolygon,
  rectsIntersect,
  type Rect,
} from "./geometry";
import type { RoadEdge, RoadGraph } from "./roads";

/** Match zone radius in metres. */
export const ZONE_RADIUS_M = 500;

/** Spawn nodes must keep this distance from building footprints. */
export const SPAWN_MIN_BUILDING_DISTANCE_M = 8;

/** Spawn nodes must keep this distance from water. */
export const SPAWN_MIN_WATER_DISTANCE_M = 6;

/**
 * Minimum share of in-zone edges that must belong to the largest connected component.
 * The WUR campus zone's real road graph tops out at 85.7 % (490 in-disc edges; the
 * remainder are short disconnected service/parking spurs) — see spec §3.3.
 */
export const MIN_CONNECTED_EDGE_SHARE = 0.85;

/** Dutch display names of the zones. */
export const ZONE_NAMES: Record<ZoneKey, string> = {
  rhenen: "Rhenen centrum",
  wageningen: "Wageningen centrum",
  campus: "WUR-campus",
  bennekom: "Bennekom",
};

/** Canonical zone order for the index and the UI. */
export const ZONE_ORDER: ZoneKey[] = [
  "rhenen",
  "wageningen",
  "campus",
  "bennekom",
];

/** Zone centre in metres. */
export type ZoneCentre = { key: ZoneKey; center: Point };

/** A landmark projected to metres. */
export type ProjectedLandmark = {
  key: string;
  center: Point;
  zoneAnchor?: ZoneKey;
};

/** A polygon obstacle with a precomputed bounding rectangle for cheap rejection. */
export type ObstaclePolygon = { ring: Point[]; bounds: Rect };

/** Options for {@link buildZones}. */
export type BuildZonesOptions = { requireConnectivity?: boolean };

/** Precomputes bounds for obstacle rings. */
export function indexObstacles(rings: Point[][]): ObstaclePolygon[] {
  return rings.map((ring) => ({ ring, bounds: boundsOf(ring) }));
}

/** Zone centres are the centroids of their anchor landmarks; every zone needs one. */
export function zoneCentresFromLandmarks(
  landmarks: ProjectedLandmark[],
): ZoneCentre[] {
  const centres: ZoneCentre[] = [];
  const missing: ZoneKey[] = [];
  for (const key of ZONE_ORDER) {
    const anchor = landmarks.find((landmark) => landmark.zoneAnchor === key);
    if (!anchor) {
      missing.push(key);
      continue;
    }
    centres.push({ key, center: anchor.center });
  }
  if (missing.length > 0) {
    throw new MapBuildError(`Zone anchors missing for: ${missing.join(", ")}`);
  }
  return centres;
}

function isClearOf(
  point: Point,
  obstacles: ObstaclePolygon[],
  minimumDistance: number,
): boolean {
  const probe: Rect = {
    minX: point[0] - minimumDistance,
    minY: point[1] - minimumDistance,
    maxX: point[0] + minimumDistance,
    maxY: point[1] + minimumDistance,
  };
  for (const obstacle of obstacles) {
    if (!rectsIntersect(probe, obstacle.bounds)) continue;
    if (distancePointToPolygon(point, obstacle.ring) < minimumDistance)
      return false;
  }
  return true;
}

class UnionFind {
  private readonly parent = new Map<number, number>();

  find(item: number): number {
    let root = item;
    while ((this.parent.get(root) ?? root) !== root)
      root = this.parent.get(root) ?? root;
    let current = item;
    while (current !== root) {
      const next = this.parent.get(current) ?? current;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

/** In-disc edges (either endpoint inside) and the vertices of their largest component. */
type ZoneRoadComponents = {
  edges: RoadEdge[];
  /** Vertices of the largest component by edge count; `null` when there are no in-disc
   * edges at all (nothing to compare, so nothing is excluded on that basis). */
  largestComponent: Set<number> | null;
  largestShare: number;
};

/**
 * Groups a zone's in-disc road edges into connected components via {@link UnionFind} and
 * picks out the largest one — shared by {@link checkZoneConnectivity} (which needs its
 * share of total edges) and {@link computeSpawnNodes} (which needs its vertex set, so
 * spawns never land on a disconnected spur).
 */
function zoneRoadComponents(
  graph: RoadGraph,
  center: Point,
  radiusMetres: number,
): ZoneRoadComponents {
  const inDisc = (vertex: number): boolean =>
    distance(graph.nodes[vertex], center) <= radiusMetres;
  const edges = graph.edges.filter((edge) => inDisc(edge.a) || inDisc(edge.b));
  if (edges.length === 0)
    return { edges, largestComponent: null, largestShare: 0 };

  const components = new UnionFind();
  for (const edge of edges) components.union(edge.a, edge.b);
  const sizes = new Map<number, number>();
  for (const edge of edges) {
    const root = components.find(edge.a);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  let largestRoot = -1;
  let largestSize = 0;
  for (const [root, size] of sizes) {
    if (size > largestSize) {
      largestSize = size;
      largestRoot = root;
    }
  }
  const largestComponent = new Set<number>();
  for (const edge of edges) {
    if (components.find(edge.a) !== largestRoot) continue;
    largestComponent.add(edge.a);
    largestComponent.add(edge.b);
  }
  return { edges, largestComponent, largestShare: largestSize / edges.length };
}

/**
 * Road-graph vertices inside the disc, on the zone's largest connected road component, that
 * are clear of buildings and water. A disconnected spur (a short service/parking stub with
 * no path to the rest of the network) never contributes spawn nodes.
 */
export function computeSpawnNodes(
  graph: RoadGraph,
  center: Point,
  radiusMetres: number,
  buildings: ObstaclePolygon[],
  water: ObstaclePolygon[],
): Point[] {
  const { largestComponent } = zoneRoadComponents(graph, center, radiusMetres);
  const spawns: Point[] = [];
  graph.nodes.forEach((node, index) => {
    if (distance(node, center) > radiusMetres) return;
    if (largestComponent && !largestComponent.has(index)) return;
    if (!isClearOf(node, buildings, SPAWN_MIN_BUILDING_DISTANCE_M)) return;
    if (!isClearOf(node, water, SPAWN_MIN_WATER_DISTANCE_M)) return;
    spawns.push(node);
  });
  return spawns;
}

/** Share of in-disc edges (either endpoint inside) that belong to the largest component. */
export function checkZoneConnectivity(
  graph: RoadGraph,
  center: Point,
  radiusMetres: number,
): { ok: boolean; largestShare: number; edgeCount: number } {
  const { edges, largestShare } = zoneRoadComponents(
    graph,
    center,
    radiusMetres,
  );
  if (edges.length === 0) return { ok: false, largestShare: 0, edgeCount: 0 };
  return {
    ok: largestShare >= MIN_CONNECTED_EDGE_SHARE,
    largestShare,
    edgeCount: edges.length,
  };
}

/** Assembles `MapZone`s in asset units; throws when a zone's roads are too fragmented. */
export function buildZones(
  centres: ZoneCentre[],
  graph: RoadGraph,
  landmarks: ProjectedLandmark[],
  buildings: ObstaclePolygon[],
  water: ObstaclePolygon[],
  options: BuildZonesOptions = {},
): MapZone[] {
  const requireConnectivity = options.requireConnectivity ?? true;
  return centres.map((zone) => {
    if (requireConnectivity) {
      const connectivity = checkZoneConnectivity(
        graph,
        zone.center,
        ZONE_RADIUS_M,
      );
      if (!connectivity.ok) {
        throw new MapBuildError(
          `Zone ${zone.key}: road network not connected enough (largest component ${(connectivity.largestShare * 100).toFixed(1)} % of ${connectivity.edgeCount} edges)`,
        );
      }
    }
    const spawnNodes = computeSpawnNodes(
      graph,
      zone.center,
      ZONE_RADIUS_M,
      buildings,
      water,
    );
    const landmarkKeys = landmarks
      .filter(
        (landmark) => distance(landmark.center, zone.center) <= ZONE_RADIUS_M,
      )
      .map((landmark) => landmark.key);
    return {
      key: zone.key,
      name: ZONE_NAMES[zone.key],
      center: [toUnits(zone.center[0]), toUnits(zone.center[1])],
      radius: toUnits(ZONE_RADIUS_M),
      spawnNodes: spawnNodes.map(
        ([x, y]) => [toUnits(x), toUnits(y)] as [number, number],
      ),
      landmarks: landmarkKeys,
    };
  });
}
