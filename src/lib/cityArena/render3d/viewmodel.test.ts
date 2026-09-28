import { describe, expect, it } from "vitest";
import {
  Box3,
  Color,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Vector3,
  type BufferAttribute,
  type Object3D,
} from "three";
import type { WeaponKind } from "../sim/types";
import { LOOKS } from "./characterLooks";
import { screenFootprint, type ScreenBox } from "./testing/screenFootprint";
import {
  createViewModel,
  placeViewModel,
  type ViewModel,
  type ViewModelInput,
} from "./viewmodel";
import { muzzleTipOf } from "./weapons3d";

const FRAME_S = 1 / 60;

const STILL: ViewModelInput = {
  weapon: "pistol",
  firedTick: null,
  tick: 100,
  speed: 0,
  dt: FRAME_S,
};

/** World matrices of every shown node, so two view models can be compared pose for pose. */
function poseOf(model: ViewModel): number[] {
  model.object.updateMatrixWorld(true);
  const elements: number[] = [];
  model.object.traverseVisible((node: Object3D) =>
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

/** The first-person camera's field of view (`cameraRig`), degrees. */
const FIRST_PERSON_FOV_DEG = 70;
/** Screen shapes the hands must suit: a desktop, an old 4:3 monitor, an ultrawide. */
const LANDSCAPES = [16 / 9, 4 / 3, 21 / 9];

/** A view model placed on a first-person camera of `aspect`, settled with `weapon` in hand. */
function placed(
  weapon: WeaponKind,
  aspect: number,
): { model: ViewModel; camera: PerspectiveCamera } {
  const camera = new PerspectiveCamera(FIRST_PERSON_FOV_DEG, aspect, 0.01, 5);
  const model = createViewModel();
  camera.add(model.object);
  placeViewModel(model.object, camera);
  runFor(model, 0.5, { ...STILL, weapon });
  return { model, camera };
}

/** The share of the lower-right quadrant (1 × 1 in device coordinates) a screen box spans. */
function quadrantShare(box: ScreenBox): number {
  return (box.maxX - box.minX) * (box.maxY - box.minY);
}

/** The forearm meshes: every mesh that is not part of the weapon or its flash. */
function armMeshes(model: ViewModel): Mesh[] {
  const arms: Mesh[] = [];
  model.object.traverseVisible((node) => {
    if (
      node instanceof Mesh &&
      !node.parent?.name.startsWith("weapon:") &&
      node.name !== "muzzleFlash"
    )
      arms.push(node);
  });
  return arms;
}

function muzzleFlash(model: ViewModel): Object3D {
  const flash = model.object.getObjectByName("muzzleFlash");
  if (!flash) throw new Error("no muzzle flash");
  return flash;
}

function weaponBounds(model: ViewModel): Box3 {
  model.object.updateMatrixWorld(true);
  return new Box3().setFromObject(model.object);
}

describe("createViewModel: the muzzle in the world", () => {
  it("finds the pistol's barrel end ahead of the eye, right of and below the crosshair", () => {
    const { model, camera } = placed("pistol", 16 / 9);
    camera.position.set(40, 1.65, -12);
    camera.lookAt(80, 1.65, -12);
    const muzzle = new Vector3();
    expect(model.muzzleWorld(muzzle)).toBe(true);
    const seen = camera.worldToLocal(muzzle.clone());
    expect(seen.z).toBeLessThan(-0.2);
    expect(seen.x).toBeGreaterThan(0.02);
    expect(seen.y).toBeLessThan(-0.02);
    expect(muzzle.x).toBeGreaterThan(40.2);
    const onScreen = muzzle.clone().project(camera);
    expect(onScreen.x).toBeGreaterThan(0);
    expect(onScreen.x).toBeLessThan(1);
    expect(onScreen.y).toBeLessThan(0);
    expect(onScreen.y).toBeGreaterThan(-1);
  });

  it("has no muzzle for fists or the bat, and leaves the target alone", () => {
    const target = new Vector3(7, 7, 7);
    for (const weapon of ["fist", "bat"] as const)
      expect(placed(weapon, 16 / 9).model.muzzleWorld(target)).toBe(false);
    expect(target.toArray()).toEqual([7, 7, 7]);
  });
});

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
      if (!(node instanceof Mesh) || node.name === "muzzleFlash") return;
      const colour = node.geometry.getAttribute("color") as BufferAttribute;
      for (let index = 0; index < colour.count; index += 1) {
        if (Math.abs(colour.getX(index) - skin.r) < 1e-4) found = true;
      }
    });
    expect(found).toBe(true);
  });

  it("never bends the layout it shares with other view models while striking", () => {
    const before = createViewModel();
    runFor(before, 0.5, { ...STILL, weapon: "bat" });
    const restPose = poseOf(before);
    const swinger = createViewModel();
    runFor(swinger, 0.5, { ...STILL, weapon: "bat" });
    swinger.update({ ...STILL, weapon: "bat", firedTick: 100 });
    const after = createViewModel();
    runFor(after, 0.5, { ...STILL, weapon: "bat" });
    expect(poseOf(after)).toEqual(restPose);
  });

  it("draws a pistol and both hands in about a quarter of the lower-right quadrant", () => {
    for (const aspect of LANDSCAPES) {
      const { model, camera } = placed("pistol", aspect);
      const box = screenFootprint(model.object, camera);
      expect(box.minX).toBeGreaterThan(0.35);
      expect(box.maxY).toBeLessThan(-0.3);
      expect(quadrantShare(box)).toBeGreaterThan(0.2);
      expect(quadrantShare(box)).toBeLessThan(0.35);
    }
  });

  it("keeps fists and every gun inside the lower-right quadrant", () => {
    const held: WeaponKind[] = ["fist", "pistol", "uzi", "shotgun", "rifle"];
    for (const weapon of [...held, "rocket" as const]) {
      const { model, camera } = placed(weapon, 16 / 9);
      const box = screenFootprint(model.object, camera);
      expect(box.minX).toBeGreaterThan(0);
      expect(box.maxY).toBeLessThan(0);
    }
  });

  it("runs every forearm off the bottom or right edge, so no arm ends in view", () => {
    for (const weapon of ["fist", "pistol", "shotgun", "bat"] as const) {
      for (const aspect of LANDSCAPES) {
        const { model, camera } = placed(weapon, aspect);
        for (const arm of armMeshes(model)) {
          const box = screenFootprint(arm, camera);
          expect(box.minY <= -0.999 || box.maxX >= 0.999).toBe(true);
        }
      }
    }
  });

  it("flashes at the barrel's end in the frame a shot fires, however long, then goes dark", () => {
    const model = createViewModel();
    runFor(model, 0.2, STILL);
    expect(muzzleFlash(model).visible).toBe(false);
    const slow = { ...STILL, firedTick: 100, dt: 1 / 12 };
    model.update(slow);
    const flash = muzzleFlash(model);
    expect(flash.visible).toBe(true);
    expect(flash.position.toArray()).toEqual(muzzleTipOf("pistol"));
    expect(flash.parent).toBe(heldWeapon(model)?.parent);
    model.update(slow);
    expect(flash.visible).toBe(false);
  });

  it("never flashes for a punch or a swing of the bat", () => {
    for (const weapon of ["fist", "bat"] as const) {
      const model = createViewModel();
      runFor(model, 0.5, { ...STILL, weapon });
      model.update({ ...STILL, weapon, firedTick: 100 });
      expect(muzzleFlash(model).visible).toBe(false);
    }
  });

  it("dispose detaches it", () => {
    const model = createViewModel();
    const parent = new Mesh();
    parent.add(model.object);
    model.dispose();
    expect(model.object.parent).toBeNull();
  });
});
