import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import type { Scene } from "../render/renderScene";
import { ADS_EASE_S } from "./cameraRig";
import {
  createFrameAim,
  localWeapon,
  probeFrame,
  raiseSights,
  scopeOf,
  type AimFrame,
} from "./frameAim";

const SCENE = {
  localPlayerId: 4,
  players: [
    { id: 4, x: 0, y: 0, vehicleId: null, diedAtTick: null, weapon: "rifle" },
  ],
  peds: [],
  cops: [],
  vehicles: [],
} as unknown as Scene;

/** A frame of `SCENE`, aiming down the sights when `ads`. */
function frameOf(extra: Partial<AimFrame> = {}): AimFrame {
  return {
    scene: SCENE,
    tiles: [],
    structures: [],
    mode: "first",
    dt: ADS_EASE_S,
    deadSeconds: null,
    ads: true,
    ...extra,
  };
}

/** A camera at the player's eye looking east. */
function eye(): PerspectiveCamera {
  const camera = new PerspectiveCamera(70, 16 / 9, 0.1, 2000);
  camera.position.set(0, 1.65, 0);
  camera.lookAt(10, 1.65, 0);
  return camera;
}

describe("raiseSights", () => {
  it("raises the sights, drops them on a weapon swap, and lowers them over a body", () => {
    const aim = createFrameAim();
    raiseSights(aim, frameOf(), "pistol");
    expect(aim.cast.sights).toBe(1);
    raiseSights(aim, frameOf({ dt: 0 }), "uzi");
    expect(aim.cast.sights).toBe(0);
    raiseSights(aim, frameOf(), "uzi");
    raiseSights(aim, frameOf({ deadSeconds: 0.5 }), "uzi");
    expect(aim.cast.sights).toBe(0);
  });

  it("never raises sights a weapon does not have", () => {
    const aim = createFrameAim();
    raiseSights(aim, frameOf(), "bat");
    expect(aim.cast.sights).toBe(0);
  });
});

describe("probeFrame", () => {
  it("hands the cast your shot at what the crosshair covers, and none while dead", () => {
    const aim = createFrameAim();
    raiseSights(aim, frameOf(), localWeapon(SCENE));
    probeFrame(aim, eye(), frameOf(), { x: 0, y: 0 });
    expect(aim.shown).toBe(true);
    expect(aim.cast.shot).toMatchObject({ ownerId: 4 });
    expect(aim.cast.shot!.y).toBeCloseTo(0);
    expect(aim.cast.shot!.x).toBeCloseTo(70);
    probeFrame(aim, eye(), frameOf({ deadSeconds: 1 }), { x: 0, y: 0 });
    expect(aim.shown).toBe(false);
    expect(aim.cast.shot).toBeNull();
  });
});

describe("scopeOf", () => {
  it("scopes the rifle behind the eyes on foot only", () => {
    const aim = createFrameAim();
    raiseSights(aim, frameOf(), "rifle");
    expect(scopeOf(aim, frameOf(), true)).toBe(1);
    expect(scopeOf(aim, frameOf({ mode: "third" }), true)).toBe(0);
    expect(scopeOf(aim, frameOf(), false)).toBe(0);
    raiseSights(aim, frameOf(), "pistol");
    expect(scopeOf(aim, frameOf(), true)).toBe(0);
  });
});
