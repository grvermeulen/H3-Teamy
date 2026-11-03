import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryDrill } from "../../lib/speelboek/library";
import { DRILLS } from "../../lib/speelboek/drills";
import DrillDetail, { PLAY_INTERVAL_MS } from "./DrillDetail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("./DrillEngagementPanel", () => ({
  default: () => <div data-testid="engagement" />,
}));

function lib(id: string): LibraryDrill {
  return {
    ...DRILLS.find((d) => d.id === id)!,
    source: "static",
    published: true,
  };
}
const manMeer = lib("4-2-man-meer");
const tipIn = lib("tip-in");
const zone = lib("zone-5-tegen-6");

describe("DrillDetail", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("steps through the drill and shows the roles of that step", () => {
    render(<DrillDetail drill={manMeer} counterpart={zone} />);

    expect(
      screen.getByText(/Stap 1 van 4 · Opstelling 4-2/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vorige stap" })).toBeDisabled();
    expect(
      screen.getByText(/Bal in de hand, kijk naar de zone/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Volgende stap" }));

    expect(
      screen.getByText(/Stap 2 van 4 · Snel rondspelen/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Speel direct door naar 6m links/),
    ).toBeInTheDocument();
  });

  it("remembers the chosen position per drill and highlights it", () => {
    render(<DrillDetail drill={manMeer} counterpart={null} />);

    fireEvent.click(screen.getByRole("button", { name: "6m rechts" }));

    expect(screen.getByText(/jij speelt 3/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "6m rechts, jouw positie" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("speelboek:position:4-2-man-meer")).toBe(
      "p3",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "6m rechts, jouw positie" }),
    );
    expect(
      window.localStorage.getItem("speelboek:position:4-2-man-meer"),
    ).toBeNull();
    expect(screen.getByText(/tik op jouw positie/)).toBeInTheDocument();
  });

  it("restores a saved position on mount", () => {
    window.localStorage.setItem("speelboek:position:tip-in", "p5");
    render(<DrillDetail drill={tipIn} counterpart={null} />);
    expect(screen.getByText(/jij speelt 5/)).toBeInTheDocument();
  });

  it("plays the animation to the last step and stops", () => {
    vi.useFakeTimers();
    render(<DrillDetail drill={tipIn} counterpart={null} />);

    fireEvent.click(screen.getByRole("button", { name: /Speel animatie/ }));
    expect(
      screen.getByRole("button", { name: "Stop animatie" }),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(PLAY_INTERVAL_MS * 3);
    });

    expect(screen.getByText(/Stap 3 van 3/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Speel animatie/ }),
    ).toBeInTheDocument();
  });

  it("links to the counterpart drill", () => {
    render(<DrillDetail drill={manMeer} counterpart={zone} />);
    expect(
      screen.getByRole("link", { name: "Verdediging-weergave" }),
    ).toHaveAttribute("href", "/speelboek/zone-5-tegen-6");
  });
});
