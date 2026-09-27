import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArenaSound } from "@/lib/cityArena/audio/sound";
import { createArenaPlayer } from "@/lib/cityArena/sim/roster";
import type { ArenaState } from "@/lib/cityArena/sim/types";
import { createVehicle } from "@/lib/cityArena/sim/vehicle";
import {
  selfMotion,
  trafficSources,
  updateFrameSound,
  type FrameSoundRuntime,
  type FrameSoundScene,
} from "./arenaSound";

/** A scene with the blended `players` and no cars. */
function sceneWith(players: FrameSoundScene["players"]): FrameSoundScene {
  return { players, vehicles: [] };
}

/** A sound whose every control is a spy. */
function spySound(): ArenaSound {
  return {
    unlock: vi.fn(),
    setEnabled: vi.fn(),
    setListener: vi.fn(),
    handleEvents: vi.fn(),
    updateEngine: vi.fn(),
    updateSelf: vi.fn(),
    updateWorld: vi.fn(),
    debug: vi.fn(),
    dispose: vi.fn(),
    radio: null,
  };
}

/** A state holding the local player (id 0) at the origin, in car 7 when `driving`. */
function stateWith(driving: boolean): ArenaState {
  const player = {
    ...createArenaPlayer([0, 0], 0),
    speed: 1.4,
    vehicleId: driving ? 7 : null,
  };
  const car = { ...createVehicle(7, "sedan", [0, 0], 0.5, 0), velocityX: 8 };
  return {
    tick: 12,
    players: [player],
    vehicles: [car],
  } as unknown as ArenaState;
}

describe("updateFrameSound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** A runtime slice around `state`. */
  function runtimeOf(state: ArenaState): FrameSoundRuntime {
    return {
      sound: spySound(),
      state,
      netplay: { kind: "offline", playerId: 0 },
    };
  }

  it("puts the ears on the blended player, facing the 3D camera's yaw", () => {
    const runtime = runtimeOf(stateWith(false));
    const blended = { ...runtime.state.players[0]!, x: 3, y: 4 };
    updateFrameSound(runtime, sceneWith([blended]), 1.2, 0.016);
    expect(runtime.sound.setListener).toHaveBeenCalledWith({
      x: 3,
      y: 4,
      facing: 1.2,
    });
  });

  it("faces north (screen up) in 2D", () => {
    const runtime = runtimeOf(stateWith(false));
    updateFrameSound(runtime, sceneWith([]), null, 0.016);
    expect(runtime.sound.setListener).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      facing: -Math.PI / 2,
    });
  });

  it("hands the player's own motion on for the footsteps", () => {
    const runtime = runtimeOf(stateWith(false));
    updateFrameSound(runtime, sceneWith([]), null, 0.016);
    expect(runtime.sound.updateSelf).toHaveBeenCalledWith({
      tick: 12,
      onFoot: true,
      speedMps: 1.4,
      car: null,
    });
  });
});

describe("selfMotion", () => {
  it("reports the car's forward speed and heading while driving, and no walking", () => {
    const state = stateWith(true);
    const motion = selfMotion(state, state.players[0]!);
    expect(motion.onFoot).toBe(false);
    expect(motion.car?.heading).toBe(0.5);
    expect(motion.car?.forwardMps).toBeCloseTo(8 * Math.cos(0.5));
  });

  it("reports neither walking nor driving once the player is dead", () => {
    const state = stateWith(true);
    const dead = { ...state.players[0]!, diedAtTick: 3 };
    expect(selfMotion(state, dead)).toMatchObject({ onFoot: false, car: null });
  });
});

describe("trafficSources", () => {
  it("hears every car but the player's own and the wrecks, with speed and siren", () => {
    const police = {
      ...createVehicle(1, "police", [10, 0], 0, 0),
      velocityY: 6,
    };
    const own = createVehicle(2, "sedan", [0, 0], 0, 0);
    const wreck = { ...createVehicle(3, "van", [5, 5], 0, 0), wrecked: true };
    const parked = createVehicle(4, "compact", [-8, 2], 0, 0);
    const sources = trafficSources(
      { vehicles: [police, own, wreck, parked], sirenVehicleIds: new Set([1]) },
      2,
    );
    expect(sources).toEqual([
      { id: 1, x: 10, y: 0, speedMps: 6, siren: true },
      { id: 4, x: -8, y: 2, speedMps: 0, siren: false },
    ]);
  });

  it("hands the traffic and the frame time to the sound", () => {
    const state = stateWith(false);
    const runtime: FrameSoundRuntime = {
      sound: spySound(),
      state,
      netplay: { kind: "offline", playerId: 0 },
    };
    const car = { ...createVehicle(7, "sedan", [4, 0], 0, 0), velocityX: 3 };
    updateFrameSound(
      runtime,
      { players: [], vehicles: [car], sirenVehicleIds: new Set() },
      null,
      0.02,
    );
    expect(runtime.sound.updateWorld).toHaveBeenCalledWith({
      dt: 0.02,
      traffic: [{ id: 7, x: 4, y: 0, speedMps: 3, siren: false }],
    });
  });
});
