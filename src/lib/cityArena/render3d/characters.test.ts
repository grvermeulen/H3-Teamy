import { describe, expect, it, vi } from "vitest";
import { Group, SkinnedMesh, Vector3, type Object3D } from "three";
import { createCharacter } from "./characters";
import { poseInto, type PoseInput } from "./characterPose";

vi.mock("./characterPose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./characterPose")>();
  return { ...actual, poseInto: vi.fn(actual.poseInto) };
});

const REST: PoseInput = {
  speed: 0,
  phaseM: 0,
  aiming: false,
  weapon: null,
  dead: false,
  tick: 0,
  recoil: 0,
};

function skinnedMeshOf(root: Object3D): SkinnedMesh {
  let found: SkinnedMesh | null = null;
  root.traverse((node) => {
    if (node instanceof SkinnedMesh) found = node;
  });
  if (!found) throw new Error("no skinned mesh");
  return found;
}

function boneWorldPosition(root: Object3D, name: string): Vector3 {
  root.updateMatrixWorld(true);
  const bone = skinnedMeshOf(root).skeleton.getBoneByName(name);
  if (!bone) throw new Error(`no bone ${name}`);
  return bone.getWorldPosition(new Vector3());
}

describe("createCharacter", () => {
  it("wraps one skinned mesh the caller can place and turn", () => {
    const character = createCharacter("ped1");
    expect(skinnedMeshOf(character.object)).toBeInstanceOf(SkinnedMesh);
    character.object.rotation.y = 1;
    character.update(REST);
    expect(character.object.rotation.y).toBe(1);
  });

  it("poses into one pose it owns, frame after frame", () => {
    const character = createCharacter("ped4");
    vi.mocked(poseInto).mockClear();
    character.update(REST);
    character.update({ ...REST, speed: 1.4, phaseM: 0.3 });
    const [first, second] = vi.mocked(poseInto).mock.calls;
    expect(first[1]).toBe(second[1]);
    expect(createCharacter("ped4")).not.toBe(character);
  });

  it("raises the right hand to aim", () => {
    const character = createCharacter("player");
    character.update({ ...REST, weapon: "pistol" });
    const lowered = boneWorldPosition(character.object, "handR");
    character.update({ ...REST, weapon: "pistol", aiming: true });
    const raised = boneWorldPosition(character.object, "handR");
    expect(raised.y).toBeGreaterThan(lowered.y + 0.3);
    expect(raised.x).toBeGreaterThan(lowered.x + 0.3);
  });

  it("puts the held weapon in the right hand and swaps it", () => {
    const character = createCharacter("cop");
    character.update({ ...REST, weapon: "pistol" });
    const mesh = skinnedMeshOf(character.object);
    const hand = mesh.skeleton.getBoneByName("handR");
    expect(hand?.children).toHaveLength(1);
    const pistol = hand?.children[0];
    character.update({ ...REST, weapon: "pistol" });
    expect(hand?.children[0]).toBe(pistol);
    character.update({ ...REST, weapon: "rocket" });
    expect(hand?.children).toHaveLength(1);
    expect(hand?.children[0]).not.toBe(pistol);
    character.update(REST);
    expect(hand?.children).toHaveLength(0);
  });

  it("finds the held gun's muzzle in the world, ahead of the aiming hand", () => {
    const character = createCharacter("player");
    character.object.position.set(10, 0, 20);
    character.update({ ...REST, weapon: "rifle", aiming: true });
    const muzzle = new Vector3();
    expect(character.muzzleWorld(muzzle)).toBe(true);
    const hand = boneWorldPosition(character.object, "handR");
    expect(muzzle.x).toBeGreaterThan(hand.x + 0.3);
    expect(muzzle.y).toBeGreaterThan(1);
    expect(muzzle.y).toBeLessThan(1.8);
    expect(Math.abs(muzzle.z - 20)).toBeLessThan(0.6);
  });

  it("has no muzzle for fists, the bat or empty hands, and leaves the target alone", () => {
    const character = createCharacter("cop");
    const target = new Vector3(7, 7, 7);
    for (const weapon of [null, "fist", "bat"] as const) {
      character.update({ ...REST, weapon });
      expect(character.muzzleWorld(target)).toBe(false);
    }
    expect(target.toArray()).toEqual([7, 7, 7]);
  });

  it("lies on the ground when dead, and stands up again", () => {
    const character = createCharacter("ped3");
    character.update({ ...REST, dead: true });
    const lyingHead = boneWorldPosition(character.object, "head");
    expect(lyingHead.y).toBeLessThan(0.4);
    const pelvis = boneWorldPosition(character.object, "pelvis");
    expect(Math.hypot(pelvis.x, pelvis.z)).toBeLessThan(0.1);
    character.update(REST);
    expect(boneWorldPosition(character.object, "head").y).toBeGreaterThan(1.5);
  });

  it("walks: the thighs swing with the distance travelled", () => {
    const character = createCharacter("ped6");
    character.update({ ...REST, speed: 1.4, phaseM: 0.35 });
    const leftKnee = boneWorldPosition(character.object, "lowerLegL");
    const rightKnee = boneWorldPosition(character.object, "lowerLegR");
    expect(leftKnee.x).toBeGreaterThan(rightKnee.x + 0.1);
  });

  it("dispose frees the skeleton, keeps shared geometry and detaches", () => {
    const parent = new Group();
    const character = createCharacter("ped2");
    parent.add(character.object);
    const mesh = skinnedMeshOf(character.object);
    const skeletonDispose = vi.spyOn(mesh.skeleton, "dispose");
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");
    character.dispose();
    expect(skeletonDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(character.object.parent).toBeNull();
  });

  it("dresses other players in the vest hue they were given", () => {
    const red = skinnedMeshOf(createCharacter("otherPlayer", 0).object);
    const green = skinnedMeshOf(createCharacter("otherPlayer", 0.33).object);
    expect(red.geometry).not.toBe(green.geometry);
  });
});
