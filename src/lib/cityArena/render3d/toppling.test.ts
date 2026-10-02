import { Group, Object3D, Quaternion } from "three";
import { describe, expect, it } from "vitest";
import { createToppling, toppledPose } from "./toppling";

describe("toppledPose", () => {
  it("is exactly where the toppling leaves the object, inside a turned parent too", () => {
    const parent = new Group();
    parent.rotation.y = 0.9;
    parent.position.set(4, 0, -2);
    const object = new Object3D();
    object.position.set(3, 0, 1);
    object.rotation.y = 0.4;
    parent.add(object);
    parent.updateMatrixWorld(true);

    const end = toppledPose(object, 1, 1, new Quaternion());
    const toppling = createToppling(0.5);
    toppling.knock(object, 1, 1);
    toppling.update(1);

    expect(object.quaternion.angleTo(end)).toBeLessThan(1e-6);
  });
});
