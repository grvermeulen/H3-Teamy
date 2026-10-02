/**
 * GTA-style mission beacons in 3D: a tall column of light over each mission contact and each
 * target of your objective, in the 2D marker's colour, gently pulsing, to be found from across
 * town (Ruling 32). Each column has two layers: a narrow core laid over the scene in the marker's
 * colour, which keeps its colour even against the pale horizon, and a wide additive glow around
 * it. The fog takes only {@link BEACON_FOG_SHARE} of them, a far beacon widens so it never thins
 * to a hairline, and they are drawn out to {@link BEACON_MIN_REACH_M} whatever the quality.
 * Columns are pooled and reused frame to frame.
 */
import {
  CylinderGeometry,
  FrontSide,
  Group,
  Mesh,
  NormalBlending,
} from "three";
import {
  createGlowMaterial,
  type GlowMaterial,
  type GlowShape,
} from "./glowMaterial";
import type { BeaconSpot } from "./missionMarkers";

/** Radius of a beacon's outer glow, metres. */
export const BEACON_RADIUS_M = 1.2;
/** Radius of a beacon's bright core, metres. */
export const BEACON_CORE_RADIUS_M = 0.35;
/** Height of a beacon's column, metres: tall enough to find over the rooftops. */
export const BEACON_HEIGHT_M = 30;
/** Seconds per pulse. */
export const BEACON_PULSE_S = 1.6;
/** How far a pulse swells and eases the column's strength, as a share of it. */
export const BEACON_PULSE_SHARE = 0.2;
/**
 * Beacons are drawn at least this far from the camera focus, whatever the quality: a contact must
 * be found from some 300 m, beyond "laag"'s 260 m city, metres.
 */
export const BEACON_MIN_REACH_M = 450;
/** Up to this far a beacon keeps its width; beyond, it widens with the distance, metres. */
export const BEACON_FULL_WIDTH_M = 100;
/** The share of a beacon the fog takes at its far end — the city it takes whole. */
export const BEACON_FOG_SHARE = 0.2;
/** The core: laid over the scene, strong, fading slowly up the column. */
export const BEACON_CORE: GlowShape = {
  opacity: 0.8,
  riseFade: 1.2,
  fogShare: BEACON_FOG_SHARE,
};
/** The glow: added to the scene around the core, fading faster toward the top. */
export const BEACON_GLOW: GlowShape = {
  opacity: 0.45,
  riseFade: 2,
  fogShare: BEACON_FOG_SHARE,
};
/** Sides of a column: round enough from close by. */
const BEACON_SIDES = 24;
/** The core draws after the glow, so the glow never washes its colour out. */
const CORE_RENDER_ORDER = 1;
/** A whole turn, radians. */
const FULL_TURN_RAD = Math.PI * 2;

/** The live beacons. */
export type Beacons3d = {
  /** Add to the scene once. */
  object: Group;
  /**
   * Stands a column over each spot within {@link beaconReach} of `focus` and hides the rest.
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
  /** Frees the column geometries and every column's materials. */
  dispose(): void;
};

/** One beacon: its column and the core and glow in it. */
type Beacon = {
  group: Group;
  core: Mesh<CylinderGeometry, GlowMaterial>;
  glow: Mesh<CylinderGeometry, GlowMaterial>;
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

/**
 * How far beacons are drawn: as far as the city, and never nearer than
 * {@link BEACON_MIN_REACH_M}.
 *
 * @param viewDistance - How far the city is drawn, metres.
 * @returns Metres.
 */
export function beaconReach(viewDistance: number): number {
  return Math.max(viewDistance, BEACON_MIN_REACH_M);
}

/**
 * How much a beacon is widened at a distance: not at all up to {@link BEACON_FULL_WIDTH_M}, then
 * in step with the distance, so its width on screen stays put.
 *
 * @param distance - Metres from the camera focus.
 * @returns A scale of 1 or more for the column's width.
 */
export function beaconWidthScale(distance: number): number {
  return Math.max(1, distance / BEACON_FULL_WIDTH_M);
}

/** One open-ended column, its foot on the ground (uv.y runs 0 at the foot to 1 at the top). */
function createColumnGeometry(radius: number): CylinderGeometry {
  const geometry = new CylinderGeometry(
    radius,
    radius,
    BEACON_HEIGHT_M,
    BEACON_SIDES,
    1,
    true,
  );
  geometry.translate(0, BEACON_HEIGHT_M / 2, 0);
  return geometry;
}

/** A layer of a beacon; only its near wall shows, so the two walls never add up to a pillar. */
function createLayer(
  geometry: CylinderGeometry,
  shape: GlowShape,
  core: boolean,
): Mesh<CylinderGeometry, GlowMaterial> {
  const material = createGlowMaterial({
    ...shape,
    colour: 0xffffff,
    side: FrontSide,
    blending: core ? NormalBlending : undefined,
  });
  const layer = new Mesh(geometry, material);
  layer.name = core ? "beaconCore" : "beaconGlow";
  if (core) layer.renderOrder = CORE_RENDER_ORDER;
  return layer;
}

/** Colours a layer and sets its strength for this frame. */
function paint(layer: Beacon["core"], colour: number, opacity: number): void {
  layer.material.uniforms.uColour.value.setHex(colour);
  layer.material.uniforms.uOpacity.value = opacity;
}

/** Stands a beacon over a spot, widened for its distance, in its colour and pulse. */
function placeBeacon(
  beacon: Beacon,
  spot: BeaconSpot,
  distance: number,
  pulse: number,
): void {
  const width = beaconWidthScale(distance);
  beacon.group.visible = true;
  beacon.group.position.set(spot.x, 0, spot.y);
  beacon.group.scale.set(width, 1, width);
  paint(beacon.core, spot.colour, BEACON_CORE.opacity * pulse);
  paint(beacon.glow, spot.colour, BEACON_GLOW.opacity * pulse);
}

/**
 * Creates the beacons.
 *
 * @returns The beacons; call `update` every frame.
 */
export function createBeacons3d(): Beacons3d {
  const object = new Group();
  object.name = "beacons";
  const coreGeometry = createColumnGeometry(BEACON_CORE_RADIUS_M);
  const glowGeometry = createColumnGeometry(BEACON_RADIUS_M);
  const beacons: Beacon[] = [];
  const beaconAt = (index: number): Beacon => {
    const existing = beacons[index];
    if (existing) return existing;
    const glow = createLayer(glowGeometry, BEACON_GLOW, false);
    const core = createLayer(coreGeometry, BEACON_CORE, true);
    const group = new Group();
    group.name = "beacon";
    group.add(glow, core);
    object.add(group);
    const beacon = { group, core, glow };
    beacons.push(beacon);
    return beacon;
  };
  return {
    object,
    update(spots, focus, viewDistance, seconds) {
      const pulse = beaconPulse(seconds);
      const reach = beaconReach(viewDistance);
      let used = 0;
      for (const spot of spots) {
        const distance = Math.hypot(spot.x - focus.x, spot.y - focus.y);
        if (distance > reach) continue;
        placeBeacon(beaconAt(used++), spot, distance, pulse);
      }
      for (let index = used; index < beacons.length; index++)
        beacons[index].group.visible = false;
    },
    dispose() {
      coreGeometry.dispose();
      glowGeometry.dispose();
      for (const { core, glow } of beacons) {
        core.material.dispose();
        glow.material.dispose();
      }
    },
  };
}
