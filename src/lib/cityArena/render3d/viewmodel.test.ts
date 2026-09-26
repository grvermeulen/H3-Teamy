import { describe, expect, it } from "vitest";
import {
  Box3,
  Color,
  Matrix4,
  Mesh,
  Vector3,
  type BufferAttribute,
  type Object3D,
} from "three";
import { LOOKS } from "./characterLooks";
import {
  createViewModel,
  type ViewModel,
  type ViewModelInput,
} from "./viewmodel";

const FRAME_S = 1 / 60;

const STILL: ViewModelInput = {
  weapon: "pistol",
  firedTick: null,
  tick: 100,
  speed: 0,
  dt: FRAME_S,
};

/** World matrices of every node, so two view models can be compared pose for pose. */
function poseOf(model: ViewModel): number[] {
  model.object.updateMatrixWorld(true);
  const elements: number[] = [];
  model.object.traverse((node: Object3D) =>
    elements.push(...new Matrix4().copy(node.matrixWorld).elements),
  );
  return elements;
}

function runFor(
  model: ViewModel,
  seconds: number,
  input: ViewModelInput,
): void {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += FRAME_S) {
    model.update(input);
  }
}

function heldWeapon(model: ViewModel): Object3D | undefined {
  let found: Object3D | undefined;
  model.object.traverse((node) => {
    if (node.name.startsWith("weapon:")) found = node;
  });
  return found;
}

function weaponBounds(model: ViewModel): Box3 {
  model.object.updateMatrixWorld(true);
  return new Box3().setFromObject(model.object);
}

describe("createViewModel", () => {
  it("recovers from a shot's kick within 0.3 s", () => {
    const shooting = createViewModel();
    const idle = createViewModel();
    shooting.update(STILL);
    idle.update(STILL);
    shooting.update({ ...STILL, firedTick: 100 });
    idle.update(STILL);
    expect(poseOf(shooting)).not.toEqual(poseOf(idle));
    runFor(shooting, 0.3, { ...STILL, firedTick: 100 });
    runFor(idle, 0.3, STILL);
    const kicked = poseOf(shooting);
    poseOf(idle).forEach((value, index) =>
      expect(kicked[index]).toBeCloseTo(value, 6),
    );
  });

  it("kicks back toward the camera on a shot", () => {
    const model = createViewModel();
    model.update(STILL);
    const before = weaponBounds(model).getCenter(new Vector3());
    model.update({ ...STILL, firedTick: 100 });
    const after = weaponBounds(model).getCenter(new Vector3());
    expect(after.z).toBeGreaterThan(before.z);
  });

  it("ignores a shot it hears about long after it was fired", () => {
    const stale = createViewModel();
    const idle = createViewModel();
    stale.update({ ...STILL, firedTick: 10 });
    idle.update(STILL);
    expect(poseOf(stale)).toEqual(poseOf(idle));
  });

  it("holds the weapon ahead of the camera, down and to the right", () => {
    const model = createViewModel();
    model.update({ ...STILL, weapon: "rifle" });
    const bounds = weaponBounds(model);
    expect(bounds.min.z).toBeLessThan(-0.6);
    expect(bounds.getCenter(new Vector3()).y).toBeLessThan(0);
  });

  it("swaps the model when the weapon changes", () => {
    const model = createViewModel();
    model.update(STILL);
    expect(heldWeapon(model)?.name).toBe("weapon:pistol");
    runFor(model, 0.5, { ...STILL, weapon: "rocket" });
    expect(heldWeapon(model)?.name).toBe("weapon:rocket");
    const names: string[] = [];
    model.object.traverse((node) => {
      if (node.name.startsWith("weapon:")) names.push(node.name);
    });
    expect(names).toEqual(["weapon:rocket"]);
  });

  it("points the barrel ahead, down the camera's −Z", () => {
    const model = createViewModel();
    runFor(model, 0.5, { ...STILL, weapon: "rocket" });
    const launcher = heldWeapon(model);
    if (!launcher) throw new Error("no weapon");
    launcher.updateWorldMatrix(true, true);
    const size = new Box3().setFromObject(launcher).getSize(new Vector3());
    expect(size.z).toBeGreaterThan(0.9);
    expect(size.x).toBeLessThan(0.3);
  });

  it("bobs while walking and stays put while standing", () => {
    const walking = createViewModel();
    const standing = createViewModel();
    walking.update(STILL);
    standing.update(STILL);
    runFor(walking, 0.25, { ...STILL, speed: 5.5 });
    runFor(standing, 0.25, STILL);
    expect(poseOf(walking)).not.toEqual(poseOf(standing));
  });

  it("draws the hands in the player's skin tone", () => {
    const model = createViewModel();
    model.update({ ...STILL, weapon: "fist" });
    const skin = new Color(LOOKS.player.skin);
    let found = false;
    model.object.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const colour = node.geometry.getAttribute("color") as BufferAttribute;
      for (let index = 0; index < colour.count; index += 1) {
        if (Math.abs(colour.getX(index) - skin.r) < 1e-4) found = true;
      }
    });
    expect(found).toBe(true);
  });

  it("dispose detaches it", () => {
    const model = createViewModel();
    const parent = new Mesh();
    parent.add(model.object);
    model.dispose();
    expect(model.object.parent).toBeNull();
  });
});
