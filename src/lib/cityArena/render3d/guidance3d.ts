/**
 * What the 3D view adds so a player finds their way and their friends (spec §6.5–6.6): the
 * navigation route glowing on the road, a beacon over each mission contact and objective, the
 * zone's edge as a wall of light, and a diamond over every other player. The 2D view's
 * equivalents are its route ribbon, mission markers, zone ring and player colours.
 */
import { Group, type Camera } from "three";
import type { Scene } from "../render/renderScene";
import { createBeacons3d } from "./beacons3d";
import type { BeaconSpot } from "./missionMarkers";
import { createPlayerMarkers3d } from "./playerMarkers3d";
import { viewDistanceFor, type RenderQuality } from "./renderer3d";
import { createRoute3d } from "./route3d";
import { createZoneWall3d } from "./zoneWall3d";

/** What the guidance reads from a frame; `View3dFrame` fits. */
export type GuidanceFrame = {
  scene: Pick<Scene, "navigation" | "zone" | "players" | "localPlayerId">;
  /** Seconds since the previous frame: the beacons pulse on it. */
  dt: number;
  quality: RenderQuality;
  size: { width: number; height: number };
};

/** The guidance layer. */
export type Guidance3d = {
  /** Add to the scene once. */
  object: Group;
  /**
   * Follows a frame: the route, the zone's edge near the focus, the beacons within the view
   * distance and the markers over the other players, turned to the camera.
   *
   * @param frame - The frame's scene, time step, quality and canvas size.
   * @param focus - The camera focus, world metres.
   * @param camera - The camera, already placed for this frame.
   * @param beacons - Where the mission beacons stand (the mission markers' `beacons`).
   */
  update(
    frame: GuidanceFrame,
    focus: { x: number; y: number },
    camera: Camera,
    beacons: readonly BeaconSpot[],
  ): void;
  /** Frees every layer's geometry and materials. */
  dispose(): void;
};

/**
 * Creates the guidance layer.
 *
 * @returns The layer; add its `object` to the scene and call `update` every frame.
 */
export function createGuidance3d(): Guidance3d {
  const route = createRoute3d();
  const zone = createZoneWall3d();
  const columns = createBeacons3d();
  const markers = createPlayerMarkers3d();
  const object = new Group();
  object.name = "guidance";
  object.add(route.object, zone.object, columns.object, markers.object);
  let seconds = 0;
  return {
    object,
    update(frame, focus, camera, beacons) {
      seconds += frame.dt;
      const { scene } = frame;
      route.update(scene.navigation);
      zone.update(scene.zone, focus);
      const reach = viewDistanceFor(frame.quality, frame.size.width);
      columns.update(beacons, focus, reach, seconds);
      markers.update(scene, focus, camera);
    },
    dispose() {
      route.dispose();
      zone.dispose();
      columns.dispose();
      markers.dispose();
    },
  };
}
