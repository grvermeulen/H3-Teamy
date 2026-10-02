import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MISDELIVERED_PARCEL } from "@/lib/cityArena/missions/catalog";
import { emptyMissionProfile } from "@/lib/cityArena/missions/world";
import { startMission } from "@/lib/cityArena/missions/runner";
import type { MissionHud } from "@/lib/cityArena/missions/hud";
import { ArenaMissionPanel } from "./ArenaMissionPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function activeMission(contractId = "parcel-1"): MissionHud {
  return {
    profile: {
      ...emptyMissionProfile(),
      run: startMission(MISDELIVERED_PARCEL, 1, contractId, 0),
    },
    definition: MISDELIVERED_PARCEL,
    offer: null,
    contact: null,
    action: "Pakket oppakken",
    destination: [10, 20],
    distanceM: 403,
    secondsLeft: 90,
    meters: [{ label: "Pakket intact", value: 80, max: 100 }],
  };
}

it("starts compact with the objective, timer, condition and nearby interaction still visible", () => {
  render(
    <ArenaMissionPanel
      mission={activeMission()}
      onAction={vi.fn()}
      onRoute={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Missiedetails uitklappen" }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText(/1\/5 ·/)).toHaveTextContent(
    MISDELIVERED_PARCEL.stages[0].text,
  );
  expect(screen.getByText(/403 m · 90 s over/)).toHaveTextContent(
    "Pakket intact: 80/100 · E / interactie: Pakket oppakken",
  );
  expect(
    screen.queryByRole("button", { name: "Hint" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(MISDELIVERED_PARCEL.stages[0].dialogue[0].text),
  ).not.toBeInTheDocument();
});

it("reveals dialogue and mission controls on demand and preserves the choice across HUD updates", () => {
  const onAction = vi.fn(),
    onRoute = vi.fn();
  const mission = activeMission();
  const view = render(
    <ArenaMissionPanel
      mission={mission}
      onAction={onAction}
      onRoute={onRoute}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Missiedetails uitklappen" }),
  );
  expect(
    screen.getByText(MISDELIVERED_PARCEL.stages[0].dialogue[0].text),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Hint", exact: true }));
  expect(onAction).toHaveBeenLastCalledWith({ kind: "hint" });
  fireEvent.click(screen.getByRole("button", { name: "Route volgen" }));
  expect(onRoute).toHaveBeenLastCalledWith([10, 20]);
  view.rerender(
    <ArenaMissionPanel
      mission={{ ...mission, distanceM: 300 }}
      onAction={onAction}
      onRoute={onRoute}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Missiedetails inklappen" }),
  ).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByRole("button", { name: "Logboek" }));
  fireEvent.click(screen.getByRole("button", { name: "Missie stoppen" }));
  expect(onAction).toHaveBeenLastCalledWith({ kind: "abandon" });
  fireEvent.click(
    screen.getByRole("button", { name: "Missiedetails inklappen" }),
  );
  expect(
    screen.queryByRole("button", { name: "Missie stoppen" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Missiedetails uitklappen" }),
  );
  view.rerender(
    <ArenaMissionPanel
      mission={activeMission("parcel-2")}
      onAction={onAction}
      onRoute={onRoute}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Missiedetails uitklappen" }),
  ).toHaveAttribute("aria-expanded", "false");
});

it.each(["completed", "failed", "abandoned"] as const)(
  "collapses the %s result even when the active mission was expanded",
  (status) => {
    const mission = activeMission();
    const onAction = vi.fn();
    const view = render(
      <ArenaMissionPanel
        mission={mission}
        onAction={onAction}
        onRoute={vi.fn()}
      />,
    );
    const result: MissionHud = {
      ...mission,
      profile: { ...mission.profile, run: { ...mission.profile.run!, status } },
    };
    fireEvent.click(
      screen.getByRole("button", { name: "Missiedetails uitklappen" }),
    );
    view.rerender(
      <ArenaMissionPanel
        mission={result}
        onAction={onAction}
        onRoute={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Missiedetails uitklappen" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Logboek", exact: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(MISDELIVERED_PARCEL.success[0].text),
    ).not.toBeInTheDocument();
    if (status === "completed")
      expect(screen.getByText(/Voltooid!/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Missiedetails uitklappen" }),
    );
    if (status === "completed")
      expect(
        screen.getByText(MISDELIVERED_PARCEL.success[0].text),
      ).toBeVisible();
    if (status === "failed") {
      fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
      expect(onAction).toHaveBeenLastCalledWith({ kind: "retry" });
    }
  },
);

it("keeps the idle logbook compact while making nearby jobs reachable", () => {
  const mission = activeMission();
  mission.profile.run = null;
  mission.definition = null;
  mission.contact = {
    name: "Noor",
    greeting: "Een pakket voor jou.",
    jobs: [{ id: "M01", title: "Verkeerd bezorgd", unavailable: null }],
  };
  const onAction = vi.fn();
  render(
    <ArenaMissionPanel
      mission={mission}
      onAction={onAction}
      onRoute={vi.fn()}
    />,
  );
  expect(screen.getByText("Werk bij Noor · tik voor opdrachten")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Verkeerd bezorgd" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Missiedetails uitklappen" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Verkeerd bezorgd" }));
  expect(onAction).toHaveBeenLastCalledWith({
    kind: "offer",
    missionId: "M01",
  });
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
