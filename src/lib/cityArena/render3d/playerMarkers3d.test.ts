import { Mesh, MeshBasicMaterial, PerspectiveCamera } from "three";
import { describe, expect, it, vi } from "vitest";
import type { Scene } from "../render/renderScene";
import { createArenaPlayer } from "../sim/roster";
import type { ArenaPlayerState } from "../sim/types";
import { vestColour } from "./characterLooks";
import { vestHueOf } from "./entityMotion";
import {
  MARKER_FULL_SIZE_M,
  MARKER_HEIGHT_M,
  MARKER_RANGE_M,
  createPlayerMarkers3d,
  markerColour,
  markerCss,
  markerScale,
  type PlayerMarkerScene,
} from "./playerMarkers3d";

const FOCUS = { x: 0, y: 0 };

function player(
  id: number,
  x: number,
  y: number,
  extra: Partial<ArenaPlayerState> = {},
): ArenaPlayerState {
  return { ...createArenaPlayer([x, y], 0), id, ...extra };
}

function sceneOf(players: ArenaPlayerState[]): PlayerMarkerScene {
  return { players, localPlayerId: 1 } satisfies Pick<
    Scene,
    "players" | "localPlayerId"
  >;
}

function camera(): PerspectiveCamera {
  const view = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  view.position.set(-4, 2, 1);
  view.lookAt(20, 1.3, 0);
  view.updateMatrixWorld();
  return view;
}

function shown(markers: ReturnType<typeof createPlayerMarkers3d>): Mesh[] {
  return markers.object.children.filter(
    (child): child is Mesh => child instanceof Mesh && child.visible,
  );
}

describe("marker colour and size", () => {
  it("wears the player's own vest colour, on the 3D diamond and the 2D arrow alike", () => {
    expect(markerColour(7)).toBe(vestColour(vestHueOf(7)));
    expect(markerColour(8)).not.toBe(markerColour(7));
    expect(markerCss(7)).toBe(
      `#${markerColour(7).toString(16).padStart(6, "0")}`,
    );
  });

  it("keeps its size up close and grows with distance beyond, so it stays readable", () => {
    expect(markerScale(0)).toBe(1);
    expect(markerScale(MARKER_FULL_SIZE_M)).toBe(1);
    expect(markerScale(MARKER_FULL_SIZE_M * 4)).toBeCloseTo(4);
  });
});

describe("createPlayerMarkers3d", () => {
  it("floats a diamond 2.6 m over each other living player within 300 m", () => {
    expect(MARKER_HEIGHT_M).toBe(2.6);
    expect(MARKER_RANGE_M).toBe(300);
    const markers = createPlayerMarkers3d();

    markers.update(
      sceneOf([
        player(1, 0, 0),
        player(7, 10, -3),
        player(8, 12, 0, { diedAtTick: 5 }),
        player(9, MARKER_RANGE_M + 1, 0),
      ]),
      FOCUS,
      camera(),
    );

    const [friend] = shown(markers);
    expect(shown(markers)).toHaveLength(1);
    expect(friend!.position.toArray()).toEqual([10, MARKER_HEIGHT_M, -3]);
    const material = friend!.material as MeshBasicMaterial;
    expect(material.color.getHex()).toBe(markerColour(7));
  });

  it("turns each diamond to the camera and grows it with the distance from it", () => {
    const markers = createPlayerMarkers3d();
    const view = camera();

    markers.update(sceneOf([player(7, 10, 0), player(8, 150, 0)]), FOCUS, view);

    const [near, far] = shown(markers);
    expect(near!.quaternion.toArray()).toEqual(view.quaternion.toArray());
    expect(far!.quaternion.toArray()).toEqual(view.quaternion.toArray());
    expect(far!.scale.x).toBeCloseTo(
      markerScale(far!.position.distanceTo(view.position)),
    );
    expect(far!.scale.x).toBeGreaterThan(near!.scale.x);
  });

  it("draws over walls and fog, after everything else", () => {
    const markers = createPlayerMarkers3d();
    markers.update(sceneOf([player(7, 10, 0)]), FOCUS, camera());

    const [friend] = shown(markers);
    const material = friend!.material as MeshBasicMaterial;
    expect(material.fog).toBe(false);
    expect(material.depthTest).toBe(false);
    expect(friend!.renderOrder).toBeGreaterThan(0);
  });

  it("frees a diamond once its player has gone, and builds none while they stay", () => {
    const markers = createPlayerMarkers3d();
    markers.update(sceneOf([player(7, 10, 0)]), FOCUS, camera());
    const [friend] = shown(markers);
    const material = vi.spyOn(friend!.material as MeshBasicMaterial, "dispose");
    markers.update(sceneOf([player(7, 11, 0)]), FOCUS, camera());
    expect(shown(markers)[0]).toBe(friend);

    markers.update(sceneOf([player(1, 0, 0)]), FOCUS, camera());

    expect(markers.object.children).toHaveLength(0);
    expect(material).toHaveBeenCalledOnce();
  });

  it("frees its diamond shape and every material", () => {
    const markers = createPlayerMarkers3d();
    markers.update(sceneOf([player(7, 10, 0)]), FOCUS, camera());
    const [friend] = shown(markers);
    const geometry = vi.spyOn(friend!.geometry, "dispose");
    const material = vi.spyOn(friend!.material as MeshBasicMaterial, "dispose");

    markers.dispose();

    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
  });
});
