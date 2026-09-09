import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoreLine } from "@/lib/cityArena/net/scoreboard";
import { ArenaCountdown } from "./ArenaCountdown";
import { ArenaScoreboard } from "./ArenaScoreboard";

/** One scoreboard line. */
function line(overrides: Partial<ScoreLine> = {}): ScoreLine {
  return {
    playerId: 1,
    kills: 0,
    deaths: 0,
    isYou: false,
    isWinner: false,
    ...overrides,
  };
}

const NAMES = new Map([
  [1, "Noor"],
  [2, "Sam"],
]);

/** The scoreboard with defaults, overridable per test. */
function renderBoard(
  props: Partial<React.ComponentProps<typeof ArenaScoreboard>> = {},
) {
  const handlers = { onRematch: vi.fn(), onLeave: vi.fn() };
  render(
    <ArenaScoreboard
      lines={[line({ playerId: 1, kills: 3, deaths: 1, isWinner: true })]}
      names={NAMES}
      secondsLeft={7}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("ArenaScoreboard for a player who is not hosting", () => {
  it("offers no way back to the lobby: the host's clock returns everyone", () => {
    renderBoard({ onRematch: undefined });
    expect(
      screen.queryByRole("button", { name: "Terug naar lobby" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Potje verlaten" }),
    ).toBeInTheDocument();
  });
});

describe("ArenaCountdown", () => {
  it("shows the number and the zone", () => {
    render(<ArenaCountdown count={3} zone="wageningen" />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Wageningen centrum")).toBeInTheDocument();
    expect(screen.getByText("Maak je klaar")).toBeInTheDocument();
  });

  it("announces the count assertively, because it is about to matter", () => {
    render(<ArenaCountdown count={1} zone="rhenen" />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-live",
      "assertive",
    );
    expect(screen.getByLabelText("Nog 1")).toBeInTheDocument();
  });
});

describe("ArenaScoreboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it("titles the potje as finished and counts down to the lobby", () => {
    renderBoard();
    expect(screen.getByText("Potje afgelopen")).toBeInTheDocument();
    expect(screen.getByText("Scorebord")).toBeInTheDocument();
    expect(screen.getByText("7s")).toBeInTheDocument();
  });

  it("names the winner and shows kills and deaths", () => {
    renderBoard();
    expect(screen.getByText("Noor")).toBeInTheDocument();
    expect(screen.getByText(/winnaar/i)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("labels the reading player as JIJ rather than by name", () => {
    renderBoard({
      lines: [line({ playerId: 2, isYou: true }), line({ playerId: 1 })],
    });
    expect(screen.getByText("Jij")).toBeInTheDocument();
    expect(screen.queryByText("Sam")).not.toBeInTheDocument();
  });

  it("falls back to a seat when a player was never named", () => {
    renderBoard({ lines: [line({ playerId: 99 })] });
    expect(screen.getByText("Speler 99")).toBeInTheDocument();
  });

  it("says nobody won when nobody scored, rather than crowning a leader", () => {
    renderBoard({
      lines: [line({ playerId: 1, deaths: 2 }), line({ playerId: 2 })],
    });
    expect(
      screen.getByText("Niemand scoorde dit potje. Geen winnaar."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/winnaar ·|· winnaar/i)).not.toBeInTheDocument();
  });

  it("does not say that when someone did score", () => {
    renderBoard();
    expect(screen.queryByText(/niemand scoorde/i)).not.toBeInTheDocument();
  });

  it("returns to the lobby and leaves through its handlers", () => {
    const handlers = renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Terug naar lobby" }));
    expect(handlers.onRematch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Potje verlaten" }));
    expect(handlers.onLeave).toHaveBeenCalledTimes(1);
  });

  it("credits OpenStreetMap", () => {
    renderBoard();
    expect(screen.getByText(/openstreetmap/i)).toBeInTheDocument();
  });
});

describe("ArenaScoreboard as the tussenstand", () => {
  it("takes the live title instead of the final one", () => {
    renderBoard({ title: "Tussenstand" });
    expect(screen.getByText("Tussenstand")).toBeInTheDocument();
    expect(screen.queryByText("Potje afgelopen")).toBeNull();
  });
});
