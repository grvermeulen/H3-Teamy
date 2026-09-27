import {
  Color,
  Mesh,
  Vector3,
  type BufferAttribute,
  type Object3D,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VEHICLE_KINDS } from "../sim/vehicle";
import {
  SPEEDO_MAX_MPS,
  WHEEL_TURN_RAD,
  createCockpit3d,
  disposeCockpitAssets,
  needleAngle,
  type CockpitInput,
} from "./cockpit3d";
import { COCKPITS } from "./cockpitSpecs";
import { bodyColour } from "./vehicleModels";

const FRAME_S = 1 / 60;

function input(overrides: Partial<CockpitInput> = {}): CockpitInput {
  return {
    kind: "sedan",
    colour: 3,
    steer: 0,
    speedMps: 0,
    siren: false,
    tick: 0,
    dt: FRAME_S,
    ...overrides,
  };
}

function named(root: Object3D, name: string): Object3D {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`no ${name}`);
  return found;
}

function meshNamed(root: Object3D, name: string): Mesh {
  return named(root, name) as Mesh;
}

function isDescendant(node: Object3D, ancestor: Object3D): boolean {
  for (let at = node.parent; at; at = at.parent)
    if (at === ancestor) return true;
  return false;
}

afterEach(() => {
  disposeCockpitAssets();
  vi.restoreAllMocks();
});

describe("createCockpit3d", () => {
  it("turns the wheel about its column by the full turn at full lock, either way", () => {
    const cockpit = createCockpit3d();
    cockpit.update(input({ steer: 1 }));
    const wheel = named(cockpit.object, "cockpit-wheel");
    expect(wheel.rotation.x).toBeCloseTo(WHEEL_TURN_RAD);
    expect(WHEEL_TURN_RAD).toBeGreaterThan(2);
    cockpit.update(input({ steer: -1, dt: 1 }));
    expect(wheel.rotation.x).toBeCloseTo(-WHEEL_TURN_RAD, 3);
    expect(wheel.rotation.y).toBe(0);
    expect(wheel.rotation.z).toBe(0);
  });

  it("eases the wheel after a keyboard's sudden full lock instead of snapping it", () => {
    const cockpit = createCockpit3d();
    cockpit.update(input({ steer: 0 }));
    cockpit.update(input({ steer: 1 }));
    const turned = named(cockpit.object, "cockpit-wheel").rotation.x;
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThan(WHEEL_TURN_RAD / 2);
  });

  it("keeps both hands on the wheel, turning with it, their forearms holding back", () => {
    const cockpit = createCockpit3d();
    cockpit.update(input());
    const wheel = named(cockpit.object, "cockpit-wheel");
    const left = named(cockpit.object, "cockpit-hand-left");
    const right = named(cockpit.object, "cockpit-hand-right");
    expect(isDescendant(left, wheel)).toBe(true);
    expect(isDescendant(right, wheel)).toBe(true);
    const rest = right.quaternion.clone();
    cockpit.update(input({ steer: 1, dt: 1 }));
    const handTurn = right.quaternion.angleTo(rest);
    expect(handTurn).toBeGreaterThan(0);
    expect(handTurn).toBeLessThan(WHEEL_TURN_RAD);
  });

  it("swings the speedometer's needle with speed, reversing too, up to its stop", () => {
    const cockpit = createCockpit3d();
    const needle = (speedMps: number): number => {
      cockpit.update(input({ speedMps }));
      return named(cockpit.object, "cockpit-needle").rotation.x;
    };
    const still = needle(0);
    expect(needle(10)).toBeGreaterThan(still);
    expect(needle(20)).toBeGreaterThan(needle(10));
    expect(needle(-20)).toBeCloseTo(needle(20));
    expect(needle(SPEEDO_MAX_MPS * 2)).toBeCloseTo(needle(SPEEDO_MAX_MPS));
    expect(needleAngle(SPEEDO_MAX_MPS)).toBeCloseTo(-needleAngle(0));
  });

  it("rebuilds for another kind or colour, and keeps its model otherwise", () => {
    const cockpit = createCockpit3d();
    cockpit.update(input());
    const sedan = cockpit.object.children[0];
    cockpit.update(input({ steer: 0.4, speedMps: 12, tick: 9 }));
    expect(cockpit.object.children).toEqual([sedan]);
    cockpit.update(input({ kind: "bus" }));
    expect(cockpit.object.children).toHaveLength(1);
    expect(cockpit.object.children[0]).not.toBe(sedan);
    expect(cockpit.object.children[0]!.name).toBe("cockpit-bus");
    const bus = cockpit.object.children[0];
    cockpit.update(input({ kind: "bus", colour: 7 }));
    expect(cockpit.object.children[0]).not.toBe(bus);
  });

  it("paints the bonnet in the car's own body colour", () => {
    const cockpit = createCockpit3d();
    cockpit.update(input({ kind: "sport", colour: 5 }));
    const bonnet = meshNamed(cockpit.object, "cockpit-bonnet");
    const colours = bonnet.geometry.getAttribute("color") as BufferAttribute;
    const expected = new Color(bodyColour("sport", 5));
    for (const index of [0, Math.floor(colours.count / 2), colours.count - 1]) {
      expect(colours.getX(index)).toBeCloseTo(expected.r, 5);
      expect(colours.getY(index)).toBeCloseTo(expected.g, 5);
      expect(colours.getZ(index)).toBeCloseTo(expected.b, 5);
    }
  });

  it("runs the bonnet out toward the nose, ahead of the windscreen", () => {
    const cockpit = createCockpit3d();
    cockpit.update(input());
    const bonnet = meshNamed(cockpit.object, "cockpit-bonnet");
    bonnet.geometry.computeBoundingBox();
    const box = bonnet.geometry.boundingBox!;
    const spec = COCKPITS.sedan;
    expect(box.min.x).toBeGreaterThanOrEqual(
      spec.eyeForwardM + spec.glass.aheadM - 0.1,
    );
    expect(box.max.x).toBeGreaterThan(1.9);
  });

  it("gives the tank grips and no wheel, and the bus no bonnet", () => {
    const tank = createCockpit3d();
    tank.update(input({ kind: "tank", steer: 1 }));
    expect(tank.object.getObjectByName("cockpit-wheel")).toBeUndefined();
    expect(tank.object.getObjectByName("cockpit-needle")).toBeUndefined();
    expect(named(tank.object, "cockpit-hand-left")).toBeDefined();
    expect(named(tank.object, "cockpit-hand-right")).toBeDefined();
    const bus = createCockpit3d();
    bus.update(input({ kind: "bus" }));
    expect(bus.object.getObjectByName("cockpit-bonnet")).toBeUndefined();
    expect(named(bus.object, "cockpit-wheel")).toBeDefined();
  });

  it("flashes the light bar's glow on the glass, blue then red, while the siren runs", () => {
    const cockpit = createCockpit3d();
    cockpit.update(input({ kind: "police" }));
    const glow = named(cockpit.object, "cockpit-header-glow");
    const blue = named(cockpit.object, "cockpit-siren-left");
    const red = named(cockpit.object, "cockpit-siren-right");
    expect(glow.visible).toBe(false);
    const seen = new Set<string>();
    for (let tick = 0; tick < 30; tick++) {
      cockpit.update(input({ kind: "police", siren: true, tick }));
      expect(glow.visible).toBe(true);
      expect(blue.visible).not.toBe(red.visible);
      seen.add(blue.visible ? "blue" : "red");
    }
    expect([...seen].sort()).toEqual(["blue", "red"]);
    const sedan = createCockpit3d();
    sedan.update(input({ siren: true }));
    expect(sedan.object.getObjectByName("cockpit-header-glow")).toBeUndefined();
  });

  it("builds every kind, keeping the parts within an arm's reach of the eye in front", () => {
    for (const kind of VEHICLE_KINDS) {
      const cockpit = createCockpit3d();
      cockpit.update(input({ kind }));
      const hand = named(cockpit.object, "cockpit-hand-right");
      cockpit.object.updateMatrixWorld(true);
      const at = hand.getWorldPosition(new Vector3());
      const spec = COCKPITS[kind];
      expect(at.x - spec.eyeForwardM, kind).toBeGreaterThan(0.2);
      expect(at.x - spec.eyeForwardM, kind).toBeLessThan(0.8);
      expect(spec.eyeHeightM - at.y, kind).toBeGreaterThan(0.1);
      expect(spec.eyeHeightM - at.y, kind).toBeLessThan(0.4);
    }
  });

  it("shares a kind's geometry between cockpits and frees it with the shared assets", () => {
    const first = createCockpit3d();
    const second = createCockpit3d();
    first.update(input());
    second.update(input());
    const shell = meshNamed(first.object, "cockpit-shell").geometry;
    expect(meshNamed(second.object, "cockpit-shell").geometry).toBe(shell);
    const bonnet = meshNamed(first.object, "cockpit-bonnet").geometry;
    expect(meshNamed(second.object, "cockpit-bonnet").geometry).toBe(bonnet);
    const freed = [shell, bonnet].map((geometry) =>
      vi.spyOn(geometry, "dispose"),
    );
    disposeCockpitAssets();
    for (const free of freed) expect(free).toHaveBeenCalledTimes(1);
    const third = createCockpit3d();
    third.update(input());
    expect(meshNamed(third.object, "cockpit-shell").geometry).not.toBe(shell);
  });

  it("detaches itself on dispose", () => {
    const cockpit = createCockpit3d();
    const parent = new Mesh();
    parent.add(cockpit.object);
    cockpit.update(input());
    cockpit.dispose();
    expect(cockpit.object.parent).toBeNull();
    expect(cockpit.object.children).toHaveLength(0);
  });
});
