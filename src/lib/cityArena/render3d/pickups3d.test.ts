import { describe, expect, it } from "vitest";
import { Color, Group, type Mesh, type MeshBasicMaterial } from "three";
import { pickupColour } from "../render/drawPickups";
import type { PickupKind } from "../sim/types";
import { createPickup3d } from "./pickups3d";

/** Every pickup kind the simulation spawns. */
const KINDS: PickupKind[] = [
  "uzi",
  "shotgun",
  "health",
  "rifle",
  "bat",
  "rocket",
];

/** The item's spinning, bobbing group inside a pickup's object. */
function itemOf(object: ReturnType<typeof createPickup3d>["object"]): Group {
  return object.getObjectByName("pickupItem") as Group;
}

describe("createPickup3d", () => {
  it.each(KINDS)("hides the %s pickup once taken", (kind) => {
    const pickup = createPickup3d(kind);
    pickup.update({ taken: false, tick: 0 });
    expect(pickup.object.visible).toBe(true);
    pickup.update({ taken: true, tick: 1 });
    expect(pickup.object.visible).toBe(false);
  });

  it("spins the item 1.2 rad per second of sim time", () => {
    const pickup = createPickup3d("uzi");
    pickup.update({ taken: false, tick: 0 });
    const start = itemOf(pickup.object).rotation.y;
    pickup.update({ taken: false, tick: 30 });
    const afterOneSecond = itemOf(pickup.object).rotation.y;
    expect(afterOneSecond - start).toBeCloseTo(1.2, 5);
  });

  it("bobs the item up and down by 0.08 m around 1.0 m", () => {
    const pickup = createPickup3d("shotgun");
    const heights: number[] = [];
    for (let tick = 0; tick < 60; tick += 1) {
      pickup.update({ taken: false, tick });
      heights.push(itemOf(pickup.object).position.y);
    }
    expect(Math.max(...heights)).toBeGreaterThan(1.0);
    expect(Math.min(...heights)).toBeLessThan(1.0);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(1.0 - 0.08 - 1e-9);
      expect(height).toBeLessThanOrEqual(1.0 + 0.08 + 1e-9);
    }
  });

  it("gives the health pickup a white box and a cross child", () => {
    const pickup = createPickup3d("health");
    expect(pickup.object.getObjectByName("cross")).toBeDefined();
    expect(pickup.object.getObjectByName("healthBox")).toBeDefined();
  });

  it.each(KINDS.filter((kind) => kind !== "health"))(
    "gives the %s pickup that weapon's model",
    (kind) => {
      const pickup = createPickup3d(kind);
      expect(pickup.object.getObjectByName(`weapon:${kind}`)).toBeDefined();
    },
  );

  it("gives every kind a ground glow disc", () => {
    for (const kind of KINDS) {
      const pickup = createPickup3d(kind);
      expect(pickup.object.getObjectByName("pickupGlow")).toBeDefined();
    }
  });

  it.each(KINDS)("colours the %s glow like its 2D pickup", (kind) => {
    const glow = createPickup3d(kind).object.getObjectByName(
      "pickupGlow",
    ) as Mesh;
    const material = glow.material as MeshBasicMaterial;
    expect(material.color.getHex()).toBe(
      new Color(pickupColour(kind)).getHex(),
    );
  });

  it("detaches from its parent on dispose", () => {
    const parent = new Group();
    const pickup = createPickup3d("bat");
    parent.add(pickup.object);
    pickup.dispose();
    expect(parent.children).toHaveLength(0);
  });
});
