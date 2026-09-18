import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MISDELIVERED_PARCEL } from "@/lib/cityArena/missions/catalog";
import { emptyMissionProfile } from "@/lib/cityArena/missions/world";
import type { MissionHud } from "@/lib/cityArena/missions/hud";
import { ArenaMissionPanel } from "./ArenaMissionPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("accepts after releasing the fire button, even when a controller snapshot replaces its callback", () => {
  vi.useFakeTimers();
  const buttons = Array.from({ length: 16 }, () => ({
    value: 0,
    pressed: false,
    touched: false,
  }));
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: vi.fn(() => [{ connected: true, mapping: "standard", buttons }]),
  });
  const mission: MissionHud = {
    profile: emptyMissionProfile(),
    definition: null,
    offer: MISDELIVERED_PARCEL,
    contact: null,
    action: null,
    destination: null,
    distanceM: null,
    secondsLeft: null,
  };
  const first = vi.fn(),
    latest = vi.fn();
  const view = render(
    <ArenaMissionPanel mission={mission} onAction={first} onRoute={vi.fn()} />,
  );
  act(() => vi.advanceTimersByTime(50));
  buttons[0].value = 1;
  act(() => vi.advanceTimersByTime(50));
  expect(first).not.toHaveBeenCalled();
  view.rerender(
    <ArenaMissionPanel mission={mission} onAction={latest} onRoute={vi.fn()} />,
  );
  buttons[0].value = 0;
  act(() => vi.advanceTimersByTime(50));
  expect(latest).toHaveBeenCalledExactlyOnceWith({
    kind: "accept",
    missionId: "M01",
  });
  buttons[2].value = 1;
  act(() => vi.advanceTimersByTime(50));
  expect(latest).toHaveBeenLastCalledWith({ kind: "close" });
  delete (navigator as Partial<Navigator>).getGamepads;
});
