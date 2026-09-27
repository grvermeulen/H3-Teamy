import { beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_FEEDBACK } from "@/lib/cityArena/render/feedback";
import { createArenaPlayer } from "@/lib/cityArena/sim/roster";
import type { ArenaState } from "@/lib/cityArena/sim/types";
import { eventSources, feelTick, type FeelRuntime } from "./arenaFeel";

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
      setListener: vi.fn(),
      handleEvents: vi.fn(),
      updateEngine: vi.fn(),
      updateSiren: vi.fn(),
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
    expect(feel.sound.handleEvents).toHaveBeenLastCalledWith(
      pickup,
      expect.objectContaining({ selfId: 4 }),
    );
    expect(
      vi.mocked(feel.haptics.fire).mock.calls.map(([kind]) => kind),
    ).toEqual(["hit", "pickup"]);
    expect(feel.feedback.vignette).toBe(1);
    expect(feel.feedback.health).toBe(70);
  });

  it("feels a nearby building collapse as a heavy pulse and a shake, and hears it", () => {
    const feel = runtime();
    feelTick(feel, stateWith(100, []));
    const collapse: ArenaState["events"] = [
      { kind: "collapse", structureId: 1, x: 5, y: 0, killerId: null },
    ];
    feelTick(feel, stateWith(100, collapse));
    expect(feel.sound.handleEvents).toHaveBeenLastCalledWith(
      collapse,
      expect.objectContaining({ selfId: 4 }),
    );
    expect(
      vi.mocked(feel.haptics.fire).mock.calls.map(([kind]) => kind),
    ).toEqual(["explosion"]);
    expect(feel.feedback.shake).toBeGreaterThan(0);
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

describe("eventSources", () => {
  it("names this client and finds a car by id, or nothing for one that is gone", () => {
    const state = {
      vehicles: [{ id: 3, x: 12, y: -4 }],
    } as unknown as ArenaState;
    const sources = eventSources(state, 4);
    expect(sources.selfId).toBe(4);
    expect(sources.vehicleAt(3)).toMatchObject({ x: 12, y: -4 });
    expect(sources.vehicleAt(9)).toBeNull();
  });
});
