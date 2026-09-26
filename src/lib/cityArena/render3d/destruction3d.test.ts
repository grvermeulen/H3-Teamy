import { describe, expect, it, vi } from "vitest";
import {
  Box3,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
  type BufferAttribute,
  type MeshLambertMaterial,
} from "three";
import type { Point } from "../world/projection";
import {
  COLLAPSE_CHUNK_COUNT,
  COLLAPSE_DEFAULT_COLOUR,
  COLLAPSE_DUST_COUNT,
  COLLAPSE_END_SHADE,
  COLLAPSE_MAX_TILT_RAD,
  COLLAPSE_S,
  createDestruction3d,
  KNOCK_OVER_S,
  RUBBLE_COLOUR,
  type CollapseInput,
} from "./destruction3d";
import { createParticleSystem } from "./particles";

const RING: Point[] = [
  [100, 200],
  [112, 200],
  [112, 208],
  [100, 208],
];

const BLOCK: CollapseInput = { structureId: 17, ring: RING, height: 12 };

function setup() {
  const particles = createParticleSystem(512, false);
  const spawn = vi.spyOn(particles, "spawn");
  return { particles, spawn, destruction: createDestruction3d(particles) };
}

function named(root: Object3D, name: string): Mesh[] {
  return root.children.filter(
    (child): child is Mesh => child instanceof Mesh && child.name === name,
  );
}

function run(update: (dt: number) => void, seconds: number): void {
  const frames = Math.round(seconds * 60);
  for (let frame = 0; frame < frames; frame++) update(1 / 60);
}

/** Degrees between a turned object's up and the world's up. */
function tiltDegrees(object: Object3D): number {
  const up = new Vector3(0, 1, 0).applyQuaternion(
    object.getWorldQuaternion(new Quaternion()),
  );
  return (up.angleTo(new Vector3(0, 1, 0)) * 180) / Math.PI;
}

describe("createDestruction3d — collapse", () => {
  it("raises a stand-in of the building over its footprint", () => {
    const { destruction } = setup();

    destruction.collapse(BLOCK);

    const [building] = named(destruction.object, "collapse");
    expect(building.position.x).toBeCloseTo(106);
    expect(building.position.z).toBeCloseTo(204);
    const box = new Box3().setFromBufferAttribute(
      building.geometry.getAttribute("position") as BufferAttribute,
    );
    expect(box.max.y).toBeCloseTo(BLOCK.height);
  });

  it("stands in in the walls' own colour, then darkens as it falls", () => {
    const { destruction } = setup();
    destruction.collapse({ ...BLOCK, colour: "#8f8878" });
    const [building] = named(destruction.object, "collapse");
    const material = building.material as MeshLambertMaterial;
    const plaster = new Color("#8f8878");

    expect(material.color.toArray()).toEqual(plaster.toArray());
    run(destruction.update, COLLAPSE_S / 2);
    const halfway = material.color.r;
    expect(halfway).toBeLessThan(plaster.r);
    run(destruction.update, COLLAPSE_S / 2 - 2 / 60);
    expect(material.color.r).toBeLessThan(halfway);
    expect(material.color.r).toBeGreaterThanOrEqual(
      plaster.r * COLLAPSE_END_SHADE - 1e-6,
    );
  });

  it("gives each falling building its own colour, a mid grey when none is known", () => {
    const { destruction } = setup();
    destruction.collapse(BLOCK);
    destruction.collapse({
      structureId: 18,
      ring: RING.map(([x, y]): Point => [x + 50, y]),
      height: 6,
      colour: "#6d3b2c",
    });
    const [grey, brick] = named(destruction.object, "collapse");

    expect(grey.material).not.toBe(brick.material);
    expect((grey.material as MeshLambertMaterial).color.getHex()).toBe(
      COLLAPSE_DEFAULT_COLOUR,
    );
    expect((brick.material as MeshLambertMaterial).color.getHexString()).toBe(
      "6d3b2c",
    );
  });

  it("frees a finished stand-in's own material", () => {
    const { destruction } = setup();
    destruction.collapse(BLOCK);
    const [building] = named(destruction.object, "collapse");
    const dispose = vi.spyOn(
      building.material as MeshLambertMaterial,
      "dispose",
    );

    run(destruction.update, COLLAPSE_S + 1 / 60);

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("sinks by its height with ease-in: a quarter of the way at half time", () => {
    const { destruction } = setup();
    destruction.collapse(BLOCK);
    const [building] = named(destruction.object, "collapse");

    destruction.update(COLLAPSE_S / 2);

    expect(building.position.y).toBeCloseTo(-BLOCK.height / 4, 1);
  });

  it("tilts at most 8° about a horizontal axis", () => {
    expect(COLLAPSE_MAX_TILT_RAD).toBeCloseTo((8 * Math.PI) / 180);
    const { destruction } = setup();
    destruction.collapse(BLOCK);
    const [building] = named(destruction.object, "collapse");

    let steepest = 0;
    for (let frame = 0; frame < 95; frame++) {
      destruction.update(1 / 60);
      steepest = Math.max(steepest, tiltDegrees(building));
      const axis = new Vector3(
        building.quaternion.x,
        building.quaternion.y,
        building.quaternion.z,
      );
      expect(Math.abs(axis.y)).toBeLessThan(1e-9);
    }

    expect(steepest).toBeGreaterThan(1);
    expect(steepest).toBeLessThanOrEqual(8 + 1e-6);
  });

  it("tilts the same way for the same structure on every screen", () => {
    const first = setup().destruction;
    const second = setup().destruction;
    first.collapse(BLOCK);
    second.collapse(BLOCK);

    first.update(1);
    second.update(1);

    const [a] = named(first.object, "collapse");
    const [b] = named(second.object, "collapse");
    expect(a.quaternion.equals(b.quaternion)).toBe(true);
  });

  it("finishes after 1.6 s: the stand-in is removed and freed", () => {
    expect(COLLAPSE_S).toBe(1.6);
    const { destruction } = setup();
    destruction.collapse(BLOCK);
    const [building] = named(destruction.object, "collapse");
    const dispose = vi.spyOn(building.geometry, "dispose");

    run(destruction.update, COLLAPSE_S - 0.1);
    expect(named(destruction.object, "collapse")).toHaveLength(1);
    run(destruction.update, 0.1 + 1 / 60);

    expect(named(destruction.object, "collapse")).toHaveLength(0);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("billows 60 dust puffs from the footprint and throws 20 chunks", () => {
    expect([COLLAPSE_DUST_COUNT, COLLAPSE_CHUNK_COUNT]).toEqual([60, 20]);
    const { destruction, spawn } = setup();

    destruction.collapse(BLOCK);
    expect(spawn.mock.calls.length).toBeGreaterThan(0);
    run(destruction.update, COLLAPSE_S + 0.1);

    expect(spawn).toHaveBeenCalledTimes(COLLAPSE_DUST_COUNT);
    const chunks = destruction.object.children.find(
      (child): child is InstancedMesh => child instanceof InstancedMesh,
    );
    expect(chunks?.count).toBe(COLLAPSE_CHUNK_COUNT);
  });

  it("ignores a second collapse of a building already coming down", () => {
    const { destruction } = setup();

    destruction.collapse(BLOCK);
    destruction.collapse(BLOCK);

    expect(named(destruction.object, "collapse")).toHaveLength(1);
  });

  it("ignores a footprint too small to be a building", () => {
    const { destruction } = setup();

    destruction.collapse({ ...BLOCK, ring: RING.slice(0, 2) });

    expect(named(destruction.object, "collapse")).toHaveLength(0);
    expect(named(destruction.object, "rubble")).toHaveLength(0);
  });

  it("leaves a rubble mound that rises as the building sinks", () => {
    const { destruction } = setup();
    destruction.collapse(BLOCK);
    const [mound] = named(destruction.object, "rubble");
    expect(mound.scale.y).toBeLessThan(0.1);

    destruction.update(COLLAPSE_S / 2);
    const rising = mound.scale.y;
    run(destruction.update, COLLAPSE_S);

    expect(rising).toBeGreaterThan(0.1);
    expect(rising).toBeLessThan(1);
    expect(mound.scale.y).toBe(1);
    expect((mound.material as MeshLambertMaterial).color.getHex()).toBe(
      RUBBLE_COLOUR,
    );
    expect(RUBBLE_COLOUR).toBe(0x4a4239);
  });
});

describe("createDestruction3d — rubble", () => {
  const OTHER: CollapseInput = {
    structureId: 18,
    ring: RING.map(([x, y]): Point => [x + 50, y]),
    height: 9,
  };

  it("keeps one mound per destroyed structure however often it is told", () => {
    const { destruction } = setup();

    destruction.setRubble([BLOCK, OTHER]);
    const first = named(destruction.object, "rubble");
    destruction.setRubble([BLOCK, OTHER]);
    const second = named(destruction.object, "rubble");

    expect(second).toHaveLength(2);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    for (const mound of second) expect(mound.scale.y).toBe(1);
  });

  it("clears the mounds of structures that have been rebuilt", () => {
    const { destruction } = setup();
    destruction.setRubble([BLOCK, OTHER]);
    const gone = named(destruction.object, "rubble").find(
      (mound) => mound.position.x > 150,
    );
    const dispose = vi.spyOn(gone!.geometry, "dispose");

    destruction.setRubble([BLOCK]);

    expect(named(destruction.object, "rubble")).toHaveLength(1);
    expect(dispose).toHaveBeenCalledOnce();
    destruction.setRubble([]);
    expect(named(destruction.object, "rubble")).toHaveLength(0);
  });

  it("does not double the mound a collapse already left", () => {
    const { destruction } = setup();
    destruction.collapse(BLOCK);

    destruction.setRubble([BLOCK]);

    expect(named(destruction.object, "rubble")).toHaveLength(1);
  });
});

describe("createDestruction3d — knock-over", () => {
  function lampPost(parent: Object3D, x: number, z: number): Object3D {
    const post = new Object3D();
    post.position.set(x, 0, z);
    parent.add(post);
    return post;
  }

  it("topples furniture 90° away from the hit over 0.5 s", () => {
    expect(KNOCK_OVER_S).toBe(0.5);
    const { destruction } = setup();
    const post = lampPost(new Group(), 10, 10);

    destruction.knockOver(post, 8, 10);
    destruction.update(KNOCK_OVER_S / 2);
    const halfway = tiltDegrees(post);
    run(destruction.update, KNOCK_OVER_S);

    expect(halfway).toBeGreaterThan(5);
    expect(halfway).toBeLessThan(85);
    expect(Math.abs(tiltDegrees(post) - 90)).toBeLessThanOrEqual(1);
    const top = new Vector3(0, 1, 0).applyQuaternion(post.quaternion);
    expect(top.x).toBeGreaterThan(0.99);
  });

  it("topples away from the hit inside a turned parent too", () => {
    const { destruction } = setup();
    const cell = new Group();
    cell.rotation.y = Math.PI / 3;
    cell.position.set(5, 0, 5);
    const post = lampPost(cell, 0, 0);
    cell.updateMatrixWorld(true);

    destruction.knockOver(post, 5, 0);
    run(destruction.update, KNOCK_OVER_S + 0.1);

    post.updateMatrixWorld(true);
    const top = new Vector3(0, 1, 0).applyQuaternion(
      post.getWorldQuaternion(new Quaternion()),
    );
    expect(Math.abs(tiltDegrees(post) - 90)).toBeLessThanOrEqual(1);
    expect(top.z).toBeGreaterThan(0.99);
  });

  it("knocks each object over only once", () => {
    const { destruction } = setup();
    const post = lampPost(new Group(), 0, 0);

    destruction.knockOver(post, -1, 0);
    run(destruction.update, KNOCK_OVER_S + 0.1);
    destruction.knockOver(post, 1, 0);
    run(destruction.update, KNOCK_OVER_S + 0.1);

    const top = new Vector3(0, 1, 0).applyQuaternion(post.quaternion);
    expect(top.x).toBeGreaterThan(0.99);
  });
});

describe("createDestruction3d — dispose", () => {
  it("frees the stand-ins, mounds and materials but leaves the particles to their owner", () => {
    const { destruction, particles } = setup();
    destruction.collapse(BLOCK);
    const [building] = named(destruction.object, "collapse");
    const [mound] = named(destruction.object, "rubble");
    const disposals = [
      vi.spyOn(building.geometry, "dispose"),
      vi.spyOn(mound.geometry, "dispose"),
      vi.spyOn(building.material as MeshLambertMaterial, "dispose"),
      vi.spyOn(mound.material as MeshLambertMaterial, "dispose"),
    ];
    const particlesDispose = vi.spyOn(particles, "dispose");

    destruction.dispose();

    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    expect(particlesDispose).not.toHaveBeenCalled();
  });
});
