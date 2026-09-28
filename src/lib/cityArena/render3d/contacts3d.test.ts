import { Group } from "three";
import { describe, expect, it, vi } from "vitest";
import { createArenaPlayer } from "../sim/roster";
import type { CharacterLook } from "./characterLooks";
import type { PoseInput } from "./characterPose";
import { headingToRotationY } from "./coords";
import {
  CONTACT_FACE_RANGE_M,
  createContacts3d,
  type ContactsScene,
  contactSeed,
} from "./contacts3d";
import {
  CHARACTER_DRAW_DISTANCE_M,
  FULL_RATE_ANIMATION_M,
} from "./entities";
import type { ContactSpot } from "./missionMarkers";

type Fake = {
  object: Group;
  look: CharacterLook;
  pose: PoseInput | null;
  update: ReturnType<typeof vi.fn>;
  muzzleWorld: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

function fakes(): {
  character: (look: CharacterLook) => Fake;
  made: Fake[];
} {
  const made: Fake[] = [];
  return {
    made,
    character: vi.fn((look: CharacterLook) => {
      const fake: Fake = {
        object: new Group(),
        look,
        pose: null,
        update: vi.fn((pose: PoseInput) => (fake.pose = { ...pose })),
        muzzleWorld: vi.fn(() => false),
        dispose: vi.fn(),
      };
      made.push(fake);
      return fake;
    }),
  };
}

const NOOR: ContactSpot = { id: "noor", x: 10, y: 0, look: "ped1" };
const VERA: ContactSpot = { id: "vera", x: -12, y: 4, look: "ped3" };

function sceneAt(x: number, y: number): ContactsScene {
  return {
    players: [{ ...createArenaPlayer([x, y], 0), id: 1 }],
    localPlayerId: 1,
    tick: 50,
  };
}

describe("createContacts3d", () => {
  it("stands each contact at their spot in their look, idle and unarmed", () => {
    const { character, made } = fakes();
    const contacts = createContacts3d({ character });

    contacts.update([NOOR, VERA], sceneAt(0, 0), { x: 0, y: 0 });

    expect(made.map((fake) => fake.look)).toEqual(["ped1", "ped3"]);
    expect(made[0]!.object.position.toArray()).toEqual([10, 0, 0]);
    expect(made[0]!.object.parent).toBe(contacts.object);
    expect(made[0]!.pose).toMatchObject({
      speed: 0,
      aiming: false,
      weapon: null,
      dead: false,
      tick: 50,
    });
  });

  it("turns to you when you come close, and faces the street as on the map otherwise", () => {
    const { character, made } = fakes();
    const contacts = createContacts3d({ character });
    const near = CONTACT_FACE_RANGE_M - 1;

    contacts.update([NOOR], sceneAt(10, near), { x: 0, y: 0 });
    expect(made[0]!.object.rotation.y).toBeCloseTo(
      headingToRotationY(Math.PI / 2),
    );
    contacts.update([NOOR], sceneAt(10 - near, 0), { x: 0, y: 0 });
    expect(made[0]!.object.rotation.y).toBeCloseTo(headingToRotationY(Math.PI));
    contacts.update([NOOR], sceneAt(10, -(CONTACT_FACE_RANGE_M + 5)), {
      x: 0,
      y: 0,
    });
    expect(made[0]!.object.rotation.y).toBeCloseTo(
      headingToRotationY(Math.PI / 2),
    );
  });

  it("draws contacts only within the characters' draw distance", () => {
    const { character, made } = fakes();
    const contacts = createContacts3d({ character });
    const far = { ...VERA, x: CHARACTER_DRAW_DISTANCE_M + 1, y: 0 };

    contacts.update([NOOR, far], sceneAt(0, 0), { x: 0, y: 0 });

    expect(made).toHaveLength(1);
  });

  it("animates each contact by the frame's time, at half rate when far", () => {
    const { character, made } = fakes();
    const contacts = createContacts3d({ character });
    const distant = { ...VERA, x: FULL_RATE_ANIMATION_M + 5, y: 0 };

    contacts.update([NOOR, distant], sceneAt(0, 0), { x: 0, y: 0 }, 0.016);

    expect(made[0]!.pose).toMatchObject({ dt: 0.016, far: false });
    expect(made[1]!.pose).toMatchObject({ dt: 0.016, far: true });
  });

  it("keeps each contact's own character by their id, never taking it down between frames", () => {
    const { character, made } = fakes();
    const contacts = createContacts3d({ character });
    const twin: ContactSpot = { ...VERA, look: NOOR.look };
    contacts.update([NOOR, twin], sceneAt(0, 0), { x: 0, y: 0 });
    const detached = made.map((fake) =>
      vi.spyOn(fake.object, "removeFromParent"),
    );

    contacts.update([twin, NOOR], sceneAt(0, 0), { x: 0, y: 0 });

    expect(character).toHaveBeenCalledTimes(2);
    for (const spy of detached) expect(spy).not.toHaveBeenCalled();
    expect(made[0]!.object.position.x).toBe(NOOR.x);
    expect(made[1]!.object.position.x).toBe(VERA.x);
  });

  it("keeps a contact's character frame to frame and frees it once they are gone", () => {
    const { character, made } = fakes();
    const contacts = createContacts3d({ character });
    contacts.update([NOOR], sceneAt(0, 0), { x: 0, y: 0 });
    contacts.update([NOOR], sceneAt(0, 0), { x: 0, y: 0 });
    expect(character).toHaveBeenCalledTimes(1);

    contacts.update([], sceneAt(0, 0), { x: 0, y: 0 });

    expect(made[0]!.object.parent).toBeNull();
    contacts.dispose();
    expect(made[0]!.dispose).toHaveBeenCalledOnce();
  });
});

describe("contactSeed", () => {
  it("gives a contact the same number every time, and different contacts different ones", () => {
    expect(contactSeed("noor")).toBe(contactSeed("noor"));
    expect(contactSeed("noor")).not.toBe(contactSeed("bram"));
    expect(Number.isInteger(contactSeed("noor"))).toBe(true);
  });
});
