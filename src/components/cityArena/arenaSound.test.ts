import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArenaSound } from "@/lib/cityArena/audio/sound";
import { createArenaPlayer } from "@/lib/cityArena/sim/roster";
import type { ArenaState } from "@/lib/cityArena/sim/types";
import { createVehicle } from "@/lib/cityArena/sim/vehicle";
import {
  selfMotion,
  updateFrameSound,
  type FrameSoundRuntime,
} from "./arenaSound";

/** A sound whose every control is a spy. */
function spySound(): ArenaSound {
  return {
    unlock: vi.fn(),
    setEnabled: vi.fn(),
    setListener: vi.fn(),
    handleEvents: vi.fn(),
    updateEngine: vi.fn(),
    updateSelf: vi.fn(),
    updateSiren: vi.fn(),
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
    updateFrameSound(runtime, { players: [blended] }, 1.2);
    expect(runtime.sound.setListener).toHaveBeenCalledWith({
      x: 3,
      y: 4,
      facing: 1.2,
    });
  });

  it("faces north (screen up) in 2D", () => {
    const runtime = runtimeOf(stateWith(false));
    updateFrameSound(runtime, { players: [] }, null);
    expect(runtime.sound.setListener).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      facing: -Math.PI / 2,
    });
  });

  it("hands the player's own motion on for the footsteps", () => {
    const runtime = runtimeOf(stateWith(false));
    updateFrameSound(runtime, { players: [] }, null);
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
