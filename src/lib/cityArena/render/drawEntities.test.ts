import { describe, expect, it } from "vitest";
import { createArenaPlayer } from "../sim/arena";
import type { MapZone } from "../world/mapTypes";
import { createCamera } from "./camera";
import {
  DEAD_PLAYER_STYLE,
  DEFAULT_PLAYER_STYLE,
  drawPlayer,
  drawZoneRing,
  playerLook,
  walkFrame,
} from "./drawEntities";
import { PLAYER_DEAD_FILL, PLAYER_FILL, ZONE_RING } from "./palette";
import { createFakeContext } from "./testing/fakeContext";

describe("drawEntities", () => {
  it("draws the player as a ringed circle at its screen position with a facing tick", () => {
    const context = createFakeContext();
    drawPlayer(
      context,
      createCamera([10, 10], 8),
      { width: 200, height: 100 },
      { x: 12, y: 10, facing: 0, speed: 4 },
    );
    expect(context.calls).toContain("arc(116,50,6,0,6.28,false)");
    expect(context.calls).toContain(`fill(${PLAYER_FILL})`);
    expect(context.calls).toContain("lineTo(126,50)");
  });

  it("draws the character sprite over the circle, turned to the player's facing", () => {
    const context = createFakeContext();
    drawPlayer(
      context,
      createCamera([10, 10], 8),
      { width: 200, height: 100 },
      { x: 12, y: 10, facing: 0, speed: 4 },
      DEFAULT_PLAYER_STYLE,
      { image: document.createElement("canvas"), pixelSize: 51, frames: 1 },
    );
    expect(context.calls).toContain("translate(116,50)");
    // Facing 0 points along +x and the art faces down its own image, so the turn is a negative
    // quarter. The positive one drew him looking half a turn away from where he walks and aims.
    expect(context.calls).toContain("rotate(-1.57)");
    // The 6 px circle radius, grown by PLAYER_SPRITE_SCALE so the man is recognisable.
    expect(
      context.calls.find((call) => call.startsWith("drawImage(")),
    ).toContain(",-9.6,-9.6,19.2,19.2");
    // The sprite shows which way he is facing, so the vector tick is not drawn as well.
    expect(context.calls).not.toContain("lineTo(126,50)");
  });

  it("walks through the strip while moving and rests on the first frame when still", () => {
    const walking = { x: 0, y: 0, facing: 0, speed: 4 };
    const standing = { x: 0, y: 0, facing: 0, speed: 0 };
    // Four ticks a frame, so 8 frames make one cycle every 32 ticks.
    expect(walkFrame(walking, 0, 8)).toBe(0);
    expect(walkFrame(walking, 4, 8)).toBe(1);
    expect(walkFrame(walking, 31, 8)).toBe(7);
    expect(walkFrame(walking, 32, 8)).toBe(0);
    // A standing player never moon-walks on the spot, and a still sprite has nowhere to go.
    expect(walkFrame(standing, 12, 8)).toBe(0);
    expect(walkFrame(walking, 12, 1)).toBe(0);
  });

  it("draws the strip cell for the current frame, not the whole sheet", () => {
    const context = createFakeContext();
    drawPlayer(
      context,
      createCamera([10, 10], 8),
      { width: 200, height: 100 },
      { x: 12, y: 10, facing: 0, speed: 4 },
      DEFAULT_PLAYER_STYLE,
      { image: document.createElement("canvas"), pixelSize: 51, frames: 8 },
      4,
    );
    // Frame 1 of a 51 px strip starts at x = 51 and is 51 wide.
    expect(
      context.calls.find((call) => call.startsWith("drawImage(")),
    ).toContain(",51,0,51,51,");
  });

  it("draws a dashed zone ring", () => {
    const zone: MapZone = {
      key: "campus",
      name: "WUR-campus",
      center: [0, 0],
      radius: 2000,
      spawnNodes: [],
      landmarks: [],
    };
    const context = createFakeContext();
    drawZoneRing(
      context,
      createCamera([0, 0], 4),
      { width: 200, height: 100 },
      zone,
    );
    expect(context.calls).toContain("arc(100,50,2000,0,6.28,false)");
    expect(context.calls).toContain(`stroke(${ZONE_RING},2)`);
    expect(context.calls).toContain("setLineDash(8,6)");
  });

  it("classifies the player look by car, death and the shield blink", () => {
    const player = createArenaPlayer([0, 0], 0);
    expect(playerLook(player, 10)).toBe("normal");
    expect(playerLook({ ...player, vehicleId: 3 }, 10)).toBe("hidden");
    expect(playerLook({ ...player, health: 0, diedAtTick: 5 }, 10)).toBe(
      "dead",
    );
    const shielded = { ...player, invulnerableUntilTick: 60 };
    expect(playerLook(shielded, 3)).toBe("normal");
    expect(playerLook(shielded, 4)).toBe("blink");
    expect(playerLook(shielded, 60)).toBe("normal");
  });

  it("draws a dead body in grey", () => {
    const context = createFakeContext();
    drawPlayer(
      context,
      createCamera([10, 10], 8),
      { width: 200, height: 100 },
      { x: 12, y: 10, facing: 0, speed: 0 },
      DEAD_PLAYER_STYLE,
    );
    expect(context.calls).toContain(`fill(${PLAYER_DEAD_FILL})`);
  });
});

describe("drawPlayer with a weapon", () => {
  it("draws the weapon over the strip, along the facing, and nothing for a fist", () => {
    const strip = {
      image: document.createElement("canvas"),
      pixelSize: 51,
      frames: 8,
    };
    const rifle = {
      image: document.createElement("canvas"),
      lengthMetres: 1.1,
      widthMetres: 0.22,
    };
    const armed = createFakeContext();
    drawPlayer(
      armed,
      createCamera([10, 10], 8),
      { width: 200, height: 100 },
      createArenaPlayer([10, 10], 0),
      undefined,
      strip,
      0,
      rifle,
    );
    const images = armed.calls.filter((call) => call.startsWith("drawImage("));
    expect(images).toHaveLength(2);
    // The circle floors at 6 px for 0.4 m: 15 px per metre, so the rifle is 16.5 by 3.3 px.
    expect(images[1]).toBe(
      `drawImage(${String(rifle.image)},-2.7,1.65,16.5,3.3)`,
    );
    const bare = createFakeContext();
    drawPlayer(
      bare,
      createCamera([10, 10], 8),
      { width: 200, height: 100 },
      createArenaPlayer([10, 10], 0),
      undefined,
      strip,
      0,
    );
    expect(
      bare.calls.filter((call) => call.startsWith("drawImage(")),
    ).toHaveLength(1);
  });
});
