import { Mesh, PerspectiveCamera, type Material, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { createArenaPlayer } from "../sim/roster";
import { MAP_UNITS_PER_METRE, type MapZone } from "../world/mapTypes";
import { createGuidance3d, type GuidanceFrame } from "./guidance3d";

const FOCUS = { x: 0, y: 0 };
const DESKTOP = { width: 1280, height: 720 };

const ZONE: MapZone = {
  key: "wageningen",
  name: "Wageningen",
  center: [0, 0],
  radius: 100 * MAP_UNITS_PER_METRE,
  spawnNodes: [],
  landmarks: [],
} as MapZone;

function frameOf(parts: Partial<GuidanceFrame> = {}): GuidanceFrame {
  return {
    scene: {
      navigation: [
        [0, 0],
        [30, 0],
      ],
      zone: ZONE,
      players: [
        { ...createArenaPlayer([0, 0], 0), id: 1 },
        { ...createArenaPlayer([12, 5], 0), id: 7 },
      ],
      localPlayerId: 1,
    },
    dt: 1 / 60,
    quality: "auto",
    size: DESKTOP,
    ...parts,
  };
}

function camera(): PerspectiveCamera {
  const view = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  view.position.set(-4, 2, 0);
  view.lookAt(20, 1.3, 0);
  return view;
}

function shownNamed(root: Object3D, name: string): number {
  let count = 0;
  root.traverseVisible((node) => {
    if (node.name === name) count += 1;
  });
  return count;
}

describe("createGuidance3d", () => {
  it("draws the route, the zone's edge, the beacons and the friends' markers from a frame", () => {
    const guidance = createGuidance3d();

    guidance.update(frameOf(), FOCUS, camera(), [
      { x: 50, y: 0, colour: 0xf3cf68 },
    ]);

    expect(shownNamed(guidance.object, "route")).toBe(1);
    expect(shownNamed(guidance.object, "zoneWall")).toBe(1);
    expect(shownNamed(guidance.object, "beacon")).toBe(1);
    expect(shownNamed(guidance.object, "playerMarker")).toBe(1);
  });

  it("stands beacons as far as the quality draws the city", () => {
    const guidance = createGuidance3d();
    const spot = [{ x: 300, y: 0, colour: 0xf3cf68 }];

    guidance.update(frameOf({ quality: "auto" }), FOCUS, camera(), spot);
    expect(shownNamed(guidance.object, "beacon")).toBe(1);
    guidance.update(frameOf({ quality: "low" }), FOCUS, camera(), spot);
    expect(shownNamed(guidance.object, "beacon")).toBe(0);
  });

  it("hides the route and the wall when the scene has neither", () => {
    const guidance = createGuidance3d();
    const bare = frameOf();
    bare.scene = { ...bare.scene, navigation: undefined, zone: null };

    guidance.update(bare, FOCUS, camera(), []);

    expect(shownNamed(guidance.object, "route")).toBe(0);
    expect(shownNamed(guidance.object, "zoneWall")).toBe(0);
  });

  it("frees every layer", () => {
    const guidance = createGuidance3d();
    guidance.update(frameOf(), FOCUS, camera(), [
      { x: 50, y: 0, colour: 0xf3cf68 },
    ]);
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    guidance.object.traverse((node) => {
      if (node instanceof Mesh)
        spies.push(vi.spyOn(node.material as Material, "dispose"));
    });

    guidance.dispose();

    expect(spies).toHaveLength(4);
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });
});
