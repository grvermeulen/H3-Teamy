/**
 * GTA-style mission beacons in 3D: a tall column of light over each mission contact and each
 * target of your objective, in the 2D marker's colour, strongest at its foot and fading upward,
 * gently pulsing. Columns are pooled and reused frame to frame; beacons beyond the view distance
 * are not drawn.
 */
import { CylinderGeometry, FrontSide, Group, Mesh } from "three";
import { createGlowMaterial, type GlowMaterial } from "./glowMaterial";
import type { BeaconSpot } from "./missionMarkers";

/** Radius of a beacon's column, metres. */
export const BEACON_RADIUS_M = 1.2;
/** Height of a beacon's column, metres: tall enough to find over the rooftops. */
export const BEACON_HEIGHT_M = 30;
/** Seconds per pulse. */
export const BEACON_PULSE_S = 1.6;
/** How far a pulse swells and eases the column's strength, as a share of it. */
export const BEACON_PULSE_SHARE = 0.2;
/**
 * A column's strength at its foot, between pulses. Light added over the pale horizon washes
 * toward white, so it is kept low enough for the contact's colour to read.
 */
const BEACON_OPACITY = 0.55;
/** How quickly a column fades toward its top. */
const BEACON_TOP_FADE = 2;
/** Sides of a column: round enough from close by. */
const BEACON_SIDES = 24;
/** A whole turn, radians. */
const FULL_TURN_RAD = Math.PI * 2;

/** The live beacons. */
export type Beacons3d = {
  /** Add to the scene once. */
  object: Group;
  /**
   * Stands a column over each spot within `viewDistance` of `focus` and hides the rest.
   *
   * @param spots - Where the beacons stand and their colours.
   * @param focus - The camera focus, world metres.
   * @param viewDistance - How far the city is drawn, metres.
   * @param seconds - The view's clock, for the pulse.
   */
  update(
    spots: readonly BeaconSpot[],
    focus: { x: number; y: number },
    viewDistance: number,
    seconds: number,
  ): void;
  /** Frees the column geometry and every column's material. */
  dispose(): void;
};

/**
 * A beacon's strength as a share of its rest strength: a slow sine swell of
 * {@link BEACON_PULSE_SHARE} each way, once every {@link BEACON_PULSE_S}.
 *
 * @param seconds - The view's clock.
 * @returns Around 1.
 */
export function beaconPulse(seconds: number): number {
  return (
    1 +
    BEACON_PULSE_SHARE * Math.sin((seconds / BEACON_PULSE_S) * FULL_TURN_RAD)
  );
}

/** One open-ended column, its foot on the ground (uv.y runs 0 at the foot to 1 at the top). */
function createColumnGeometry(): CylinderGeometry {
  const geometry = new CylinderGeometry(
    BEACON_RADIUS_M,
    BEACON_RADIUS_M,
    BEACON_HEIGHT_M,
    BEACON_SIDES,
    1,
    true,
  );
  geometry.translate(0, BEACON_HEIGHT_M / 2, 0);
  return geometry;
}

/** True when a spot lies within `distance` of the focus. */
function inView(
  spot: BeaconSpot,
  focus: { x: number; y: number },
  distance: number,
): boolean {
  const dx = spot.x - focus.x;
  const dy = spot.y - focus.y;
  return dx * dx + dy * dy <= distance * distance;
}

/**
 * Creates the beacons.
 *
 * @returns The beacons; call `update` every frame.
 */
export function createBeacons3d(): Beacons3d {
  const object = new Group();
  object.name = "beacons";
  const geometry = createColumnGeometry();
  const columns: Mesh<CylinderGeometry, GlowMaterial>[] = [];
  const columnAt = (index: number): Mesh<CylinderGeometry, GlowMaterial> => {
    const existing = columns[index];
    if (existing) return existing;
    const glow = createGlowMaterial({
      colour: 0xffffff,
      opacity: BEACON_OPACITY,
      riseFade: BEACON_TOP_FADE,
      // Only the near wall glows: both walls added up read as a solid white pillar.
      side: FrontSide,
    });
    const column = new Mesh(geometry, glow);
    column.name = "beacon";
    columns.push(column);
    object.add(column);
    return column;
  };
  return {
    object,
    update(spots, focus, viewDistance, seconds) {
      const strength = BEACON_OPACITY * beaconPulse(seconds);
      let used = 0;
      for (const spot of spots) {
        if (!inView(spot, focus, viewDistance)) continue;
        const column = columnAt(used++);
        column.visible = true;
        column.position.set(spot.x, 0, spot.y);
        column.material.uniforms.uColour.value.setHex(spot.colour);
        column.material.uniforms.uOpacity.value = strength;
      }
      for (let index = used; index < columns.length; index++)
        columns[index].visible = false;
    },
    dispose() {
      geometry.dispose();
      for (const column of columns) column.material.dispose();
    },
  };
}
