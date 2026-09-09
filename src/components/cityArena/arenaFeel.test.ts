import { beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_FEEDBACK } from "@/lib/cityArena/render/feedback";
import { createArenaPlayer } from "@/lib/cityArena/sim/roster";
import type { ArenaState } from "@/lib/cityArena/sim/types";
import { feelTick, type FeelRuntime } from "./arenaFeel";

/** A state holding only this client's player and the events given. */
function stateWith(health: number, events: ArenaState["events"]): ArenaState {
  return {
    tick: 3,
    players: [{ ...createArenaPlayer([0, 0], 0), id: 4, health }],
    events,
  } as unknown as ArenaState;
}

/** The slice of a runtime the feel touches, with spies where it acts. */
function runtime(): FeelRuntime {
  return {
    sound: {
      unlock: vi.fn(),
      setEnabled: vi.fn(),
      handleEvents: vi.fn(),
      updateEngine: vi.fn(),
      dispose: vi.fn(),
    },
    haptics: { fire: vi.fn() },
    feedback: INITIAL_FEEDBACK,
    netplay: { kind: "offline", playerId: 4 },
    reducedMotion: false,
  };
}

describe("feelTick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hears, feels and shows the same tick", () => {
    const feel = runtime();
    feelTick(feel, stateWith(100, []));
    const pickup: ArenaState["events"] = [
      { kind: "pickup", pickupKind: "uzi", playerId: 4, x: 0, y: 0 },
    ];
    feelTick(feel, stateWith(70, pickup));
    expect(feel.sound.handleEvents).toHaveBeenLastCalledWith(pickup);
    expect(
      vi.mocked(feel.haptics.fire).mock.calls.map(([kind]) => kind),
    ).toEqual(["hit", "pickup"]);
    expect(feel.feedback.vignette).toBe(1);
    expect(feel.feedback.health).toBe(70);
  });

  it("keeps the sound but nothing else when this client has no player in the state", () => {
    const feel = runtime();
    feel.netplay = { kind: "offline", playerId: 99 };
    feelTick(feel, stateWith(100, [{ kind: "explosion", x: 0, y: 0 }]));
    expect(feel.sound.handleEvents).toHaveBeenCalledTimes(1);
    expect(feel.haptics.fire).not.toHaveBeenCalled();
    expect(feel.feedback).toBe(INITIAL_FEEDBACK);
  });
});
