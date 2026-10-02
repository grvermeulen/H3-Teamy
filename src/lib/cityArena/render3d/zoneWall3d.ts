/**
 * The match zone's edge in 3D (spec §6.5, the 2D `drawZoneRing`): a translucent wall of light
 * standing on the zone's ring, drawn whenever the 2D view draws the ring. Only the stretch within
 * {@link ZONE_WALL_REACH_M} of the player is built — a zone is kilometres round, and what lies
 * further is lost in the fog anyway — in buffers made once and rewritten as the player moves.
 */
import { BufferAttribute, BufferGeometry, Mesh } from "three";
import { ZONE_RGB } from "../render/palette";
import type { MapZone } from "../world/mapTypes";
import { fromUnits } from "../world/projection";
import { createGlowMaterial } from "./glowMaterial";

/** Height of the wall, metres. */
export const ZONE_WALL_HEIGHT_M = 12;
/** The wall stands only along the ring within this distance of the player, metres. */
export const ZONE_WALL_REACH_M = 150;
/** Columns the wall's stretch is built from, however long it is. */
const ZONE_WALL_SEGMENTS = 64;
/** Strength of the wall's glow at its foot. */
const ZONE_WALL_OPACITY = 0.55;
/** How quickly the wall fades toward its top. */
const ZONE_WALL_TOP_FADE = 1.3;
/** A whole turn, radians. */
const FULL_TURN_RAD = Math.PI * 2;
/** Vertices per column (foot and top) and floats per position. */
const COLUMN_VERTICES = 2;
const XYZ = 3;

/** A stretch of a ring: from `start` (radians, `atan2` of the world's y over x) round by `sweep`. */
export type ZoneArc = { start: number; sweep: number };

/** The live zone wall. */
export type ZoneWall3d = {
  /** Add to the scene once; hidden without a zone or a stretch in reach. */
  object: Mesh;
  /** Stands the wall along the zone's ring near `focus`, or hides it. Allocates nothing. */
  update(zone: MapZone | null, focus: { x: number; y: number }): void;
  /** Frees the wall's geometry and material. */
  dispose(): void;
};

/**
 * The stretch of a ring within `reach` of a point: the circle's points whose distance to `from`
 * is at most `reach`, as one arc centred on `from`'s side of the ring.
 *
 * @param centre - The ring's centre, world metres.
 * @param radius - Its radius, metres.
 * @param from - The player.
 * @param reach - How far from the player the stretch may run, metres.
 * @param out - Written and returned, so a frame allocates nothing.
 * @returns `out`, the whole ring when all of it is in reach, or `null` when none is.
 */
export function zoneArc(
  centre: { x: number; y: number },
  radius: number,
  from: { x: number; y: number },
  reach: number,
  out: ZoneArc,
): ZoneArc | null {
  const dx = from.x - centre.x;
  const dy = from.y - centre.y;
  const apart = Math.hypot(dx, dy);
  if (radius <= 0 || Math.abs(radius - apart) > reach) return null;
  const cosLimit =
    apart === 0
      ? -1
      : (radius * radius + apart * apart - reach * reach) /
        (2 * radius * apart);
  if (cosLimit <= -1) {
    out.start = 0;
    out.sweep = FULL_TURN_RAD;
    return out;
  }
  const half = Math.acos(Math.min(1, cosLimit));
  out.start = Math.atan2(dy, dx) - half;
  out.sweep = 2 * half;
  return out;
}

/** The wall's buffers: a strip of foot and top vertices, u along the stretch, v up. */
function createWallGeometry(): BufferGeometry {
  const columns = ZONE_WALL_SEGMENTS + 1;
  const geometry = new BufferGeometry();
  const positions = new Float32Array(columns * COLUMN_VERTICES * XYZ);
  const uvs = new Float32Array(columns * COLUMN_VERTICES * 2);
  const indices = new Uint16Array(ZONE_WALL_SEGMENTS * 6);
  for (let column = 0; column < columns; column++) {
    const u = column / ZONE_WALL_SEGMENTS;
    uvs.set([u, 0, u, 1], column * 4);
    if (column === ZONE_WALL_SEGMENTS) continue;
    const at = column * COLUMN_VERTICES;
    indices.set([at, at + 2, at + 1, at + 1, at + 2, at + 3], column * 6);
  }
  geometry.setAttribute("position", new BufferAttribute(positions, XYZ));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

/** Rewrites the wall's vertices along an arc of the ring. */
function standWall(
  position: BufferAttribute,
  centre: { x: number; y: number },
  radius: number,
  arc: ZoneArc,
): void {
  for (let column = 0; column <= ZONE_WALL_SEGMENTS; column++) {
    const angle = arc.start + (arc.sweep * column) / ZONE_WALL_SEGMENTS;
    const x = centre.x + Math.cos(angle) * radius;
    const z = centre.y + Math.sin(angle) * radius;
    const at = column * COLUMN_VERTICES;
    position.setXYZ(at, x, 0, z);
    position.setXYZ(at + 1, x, ZONE_WALL_HEIGHT_M, z);
  }
  position.needsUpdate = true;
}

/**
 * Creates the zone wall: additive in the 2D ring's blue, strongest at its foot and fading upward,
 * seen from inside and out, fading into the fog.
 *
 * @returns The wall; call `update` every frame with the scene's zone and the camera focus.
 */
export function createZoneWall3d(): ZoneWall3d {
  const material = createGlowMaterial({
    colour: `rgb(${ZONE_RGB.join(",")})`,
    opacity: ZONE_WALL_OPACITY,
    riseFade: ZONE_WALL_TOP_FADE,
  });
  const mesh = new Mesh(createWallGeometry(), material);
  mesh.name = "zoneWall";
  mesh.visible = false;
  // The wall moves with the player inside fixed buffers, so a bounding sphere would go stale.
  mesh.frustumCulled = false;
  const position = mesh.geometry.getAttribute("position") as BufferAttribute;
  const arc: ZoneArc = { start: 0, sweep: 0 };
  const centre = { x: 0, y: 0 };
  let ringOf: MapZone | null = null;
  let radius = 0;
  return {
    object: mesh,
    update(zone, focus) {
      if (zone && zone !== ringOf) {
        ringOf = zone;
        centre.x = fromUnits(zone.center[0]);
        centre.y = fromUnits(zone.center[1]);
        radius = fromUnits(zone.radius);
      }
      const found =
        zone && zoneArc(centre, radius, focus, ZONE_WALL_REACH_M, arc);
      mesh.visible = Boolean(found);
      if (found) standWall(position, centre, radius, found);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
