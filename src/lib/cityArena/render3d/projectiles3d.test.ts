import { describe, expect, it, vi } from "vitest";
import {
  Box3,
  Mesh,
  Vector3,
  type BufferAttribute,
  type LineSegments,
  type Object3D,
} from "three";
import type { BulletState } from "../sim/types";
import { WEAPONS } from "../sim/weapons";
import { PERSON_CHEST_HEIGHT_M, headingToRotationY } from "./coords";
import { createParticleSystem } from "./particles";
import {
  createProjectiles3d,
  ROCKET_LENGTH_M,
  TRACER_LENGTH_M,
} from "./projectiles3d";

/** A pistol round 20 m into its flight, heading east. */
const ROUND: BulletState = {
  id: 1,
  ownerId: 7,
  ignoreVehicleId: null,
  x: 100,
  y: 50,
  directionX: 1,
  directionY: 0,
  speedMps: 120,
  rangeLeftM: WEAPONS.pistol.rangeM - 20,
  damage: 20,
  weapon: "pistol",
};

function setup() {
  const fire = createParticleSystem(256, true);
  const smoke = createParticleSystem(256, false);
  const projectiles = createProjectiles3d(fire, smoke);
  return { fire, smoke, projectiles };
}

function tracers(root: Object3D): LineSegments {
  const lines = root.getObjectByName("tracers");
  if (!lines) throw new Error("no tracers");
  return lines as LineSegments;
}

/** A pistol held by the shooter of {@link ROUND}, fired from (80, 50): ahead, right and up. */
const MUZZLE = new Vector3(80.7, 1.47, 50.12);

/** The first tracer's head (at the round) and tail. */
function tracerEnds(root: Object3D): { head: Vector3; tail: Vector3 } {
  const position = tracers(root).geometry.getAttribute(
    "position",
  ) as BufferAttribute;
  return {
    head: new Vector3().fromBufferAttribute(position, 0),
    tail: new Vector3().fromBufferAttribute(position, 1),
  };
}

function segmentCount(root: Object3D): number {
  return tracers(root).geometry.drawRange.count / 2;
}

function visibleNamed(root: Object3D, name: string): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((node) => {
    if (node.name === name && node.visible) found.push(node);
  });
  return found;
}

describe("createProjectiles3d", () => {
  it("draws a gun round as a 3 m tracer at chest height, back along its flight", () => {
    const { projectiles } = setup();

    projectiles.sync([{ ...ROUND, directionX: 0.6, directionY: 0.8 }]);

    expect(TRACER_LENGTH_M).toBe(3);
    expect(segmentCount(projectiles.object)).toBe(1);
    const position = tracers(projectiles.object).geometry.getAttribute(
      "position",
    ) as BufferAttribute;
    expect(position.getX(0)).toBe(100);
    expect(position.getY(0)).toBeCloseTo(PERSON_CHEST_HEIGHT_M);
    expect(position.getZ(0)).toBe(50);
    expect(position.getX(1)).toBeCloseTo(100 - 0.6 * 3);
    expect(position.getY(1)).toBeCloseTo(PERSON_CHEST_HEIGHT_M);
    expect(position.getZ(1)).toBeCloseTo(50 - 0.8 * 3);
  });

  it("never draws a tracer back past the muzzle", () => {
    const { projectiles } = setup();

    projectiles.sync([{ ...ROUND, rangeLeftM: WEAPONS.pistol.rangeM - 1 }]);

    const position = tracers(projectiles.object).geometry.getAttribute(
      "position",
    ) as BufferAttribute;
    expect(position.getX(1)).toBeCloseTo(99);
  });

  it("draws no tracer for a fist or a bat", () => {
    const { projectiles } = setup();

    projectiles.sync([
      { ...ROUND, weapon: "fist" },
      { ...ROUND, id: 2, weapon: "bat" },
    ]);

    expect(segmentCount(projectiles.object)).toBe(0);
  });

  it("flies a rocket as a 0.9 m body along its heading instead of a tracer", () => {
    const { projectiles } = setup();

    projectiles.sync([
      { ...ROUND, weapon: "rocket", directionX: 0, directionY: 1 },
    ]);

    expect(segmentCount(projectiles.object)).toBe(0);
    const [rocket] = visibleNamed(projectiles.object, "rocket");
    expect(rocket.position.toArray()).toEqual([100, PERSON_CHEST_HEIGHT_M, 50]);
    expect(rocket.rotation.y).toBeCloseTo(headingToRotationY(Math.PI / 2));
    const body = rocket.getObjectByName("rocket-body") as Mesh;
    const size = new Box3()
      .setFromBufferAttribute(
        body.geometry.getAttribute("position") as BufferAttribute,
      )
      .getSize(new Vector3());
    expect(ROCKET_LENGTH_M).toBe(0.9);
    expect(size.x).toBeCloseTo(ROCKET_LENGTH_M, 5);
  });

  it("trails smoke behind a rocket, evenly by distance flown", () => {
    const { projectiles, smoke } = setup();
    const rocket: BulletState = { ...ROUND, weapon: "rocket" };
    projectiles.sync([rocket]);
    const before = smoke.alive();

    projectiles.sync([{ ...rocket, x: rocket.x + 0.75 }]);
    const oneFrame = smoke.alive() - before;
    projectiles.sync([{ ...rocket, x: rocket.x + 3.75 }]);
    const fourFrames = smoke.alive() - before - oneFrame;

    expect(oneFrame).toBeGreaterThanOrEqual(1);
    expect(fourFrames).toBeGreaterThanOrEqual(oneFrame * 3);
  });

  it("puts the rocket back in the pool when it is gone and reuses it", () => {
    const { projectiles } = setup();
    const rocket: BulletState = { ...ROUND, weapon: "rocket" };
    projectiles.sync([rocket]);
    const [first] = visibleNamed(projectiles.object, "rocket");

    projectiles.sync([]);
    expect(visibleNamed(projectiles.object, "rocket")).toHaveLength(0);

    projectiles.sync([{ ...rocket, id: 9 }]);
    const [second] = visibleNamed(projectiles.object, "rocket");
    expect(second).toBe(first);
  });

  it("fires the tank's shell as a glowing slug with a faint trail", () => {
    const { projectiles, fire } = setup();
    const shell = { ...ROUND, weapon: "cannon" as const };

    projectiles.sync([shell]);
    projectiles.sync([{ ...shell, x: shell.x + 3 }]);

    expect(segmentCount(projectiles.object)).toBe(0);
    expect(visibleNamed(projectiles.object, "shell")).toHaveLength(1);
    expect(fire.alive()).toBeGreaterThan(0);
  });

  it("draws a round just out of a known muzzle on from that muzzle, its tail at the barrel", () => {
    const { projectiles } = setup();
    const muzzles = new Map([[ROUND.ownerId, MUZZLE]]);

    projectiles.sync(
      [{ ...ROUND, x: 81, rangeLeftM: WEAPONS.pistol.rangeM - 1 }],
      muzzles,
    );

    const ends = tracerEnds(projectiles.object);
    const oneMetreOn = MUZZLE.clone().add(new Vector3(1, 0, 0));
    expect(ends.head.distanceTo(oneMetreOn)).toBeLessThan(0.2);
    expect(ends.tail.distanceTo(MUZZLE)).toBeCloseTo(0);
  });

  it("puts a round from a muzzle back on its flat line by 20 m flown", () => {
    const { projectiles } = setup();

    projectiles.sync([ROUND], new Map([[ROUND.ownerId, MUZZLE]]));

    const { head } = tracerEnds(projectiles.object);
    const onLine = new Vector3(100, PERSON_CHEST_HEIGHT_M, 50);
    expect(head.distanceTo(onLine)).toBeCloseTo(0, 5);
  });

  it("draws a round whose shooter has no muzzle exactly as on its flat line", () => {
    const { projectiles } = setup();
    const round = { ...ROUND, rangeLeftM: WEAPONS.pistol.rangeM - 2 };

    projectiles.sync([round], new Map([[99, MUZZLE]]));

    const { head, tail } = tracerEnds(projectiles.object);
    const onLine = new Vector3(100, PERSON_CHEST_HEIGHT_M, 50);
    expect(head.distanceTo(onLine)).toBeCloseTo(0, 5);
    expect(tail.x).toBeCloseTo(98);
    expect(tail.y).toBeCloseTo(PERSON_CHEST_HEIGHT_M);
  });

  it("never draws a tail back behind the muzzle", () => {
    const { projectiles } = setup();
    const muzzles = new Map([[ROUND.ownerId, MUZZLE]]);
    for (const flown of [0.2, 1, 2.5, 3, 6, 12]) {
      projectiles.sync(
        [
          {
            ...ROUND,
            x: 80 + flown,
            rangeLeftM: WEAPONS.pistol.rangeM - flown,
          },
        ],
        muzzles,
      );
      const { tail } = tracerEnds(projectiles.object);
      expect(tail.x, `${flown} m`).toBeGreaterThanOrEqual(MUZZLE.x - 1e-4);
    }
  });

  it("launches a rocket from the tube, keeping the muzzle it left even as the shooter moves", () => {
    const { projectiles } = setup();
    const rocket: BulletState = {
      ...ROUND,
      weapon: "rocket",
      x: 80.8,
      rangeLeftM: WEAPONS.rocket.rangeM,
    };
    const muzzle = MUZZLE.clone();

    projectiles.sync([rocket], new Map([[ROUND.ownerId, muzzle]]));
    const [body] = visibleNamed(projectiles.object, "rocket");
    expect(body!.position.distanceTo(MUZZLE)).toBeCloseTo(0);

    muzzle.set(0, 0, 0);
    projectiles.sync(
      [{ ...rocket, x: 81.8, rangeLeftM: WEAPONS.rocket.rangeM - 1 }],
      new Map([[ROUND.ownerId, muzzle]]),
    );
    const oneMetreOn = MUZZLE.clone().add(new Vector3(1, 0, 0));
    expect(body!.position.distanceTo(oneMetreOn)).toBeLessThan(0.2);
  });

  it("frees its geometry and materials", () => {
    const { projectiles } = setup();
    projectiles.sync([{ ...ROUND, weapon: "rocket" }]);
    const lines = tracers(projectiles.object);
    const geometry = vi.spyOn(lines.geometry, "dispose");
    const body = visibleNamed(projectiles.object, "rocket-body")[0] as Mesh;
    const bodyGeometry = vi.spyOn(body.geometry, "dispose");

    projectiles.dispose();

    expect(geometry).toHaveBeenCalledOnce();
    expect(bodyGeometry).toHaveBeenCalledOnce();
  });
});
