import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventList from "./EventList";
import { verifiedFixturesToTeamEvents } from "../lib/knzbVerifiedH3Gap2026";
import { H3_GAP_OCT_NOV_2026_FIXTURES } from "../lib/knzbVerifiedH3Gap2026";

const sessionState = {
  loading: false,
  loggedIn: true,
  isAdmin: true,
  isTrainer: false,
  refresh: async () => {},
};

vi.mock("./SessionContext", () => ({ useSession: () => sessionState }));

vi.mock("./spaceInvaders/SpaceInvadersLauncher", () => ({
  default: () => null,
}));
vi.mock("./cityArena/CityArenaLauncher", () => ({ default: () => null }));
vi.mock("./GenerateReportButton", () => ({
  default: () => <div data-testid="report-gen">gen</div>,
}));
vi.mock("./ReportPreview", () => ({ default: () => null }));
vi.mock("./MvpVoteButton", () => ({ default: () => null }));

const KNOWN_EVENTS = verifiedFixturesToTeamEvents(H3_GAP_OCT_NOV_2026_FIXTURES);

function wrapNarrow(ui: React.ReactNode) {
  return (
    <div data-testid="viewport-320" style={{ width: 320, maxWidth: 320 }}>
      {ui}
    </div>
  );
}

describe("EventList mobiele layout (imported fixtures)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("SEASON_START", "[REDACTED]");
    vi.stubEnv("SEASON_END", "01-07-2027");
    sessionState.loggedIn = true;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        counts: { yes: 12, maybe: 0, no: 9 },
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("gebruikt breakpoint-veilige markup voor RSVP, bron-URL en vernieuw-tip", async () => {
    render(
      wrapNarrow(
        <EventList
          events={KNOWN_EVENTS}
          nowMs={new Date("2026-11-08T14:30:00.000Z").getTime()}
        />,
      ),
    );

    expect(
      await screen.findByText("NDD H3 - De Rijn H3", undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument();

    const viewport = screen.getByTestId("viewport-320");
    const card = viewport.querySelector(".card");
    expect(card).toBeTruthy();
    expect(card!.querySelector(".event-card-top")).toBeTruthy();
    expect(card!.querySelector(".event-rsvp-toggle")).toBeTruthy();
    expect(card!.querySelector(".event-description")).toBeTruthy();
    expect(viewport.querySelector(".event-list-refresh")).toBeTruthy();

    const description = card!.querySelector(".event-description");
    expect(description?.textContent).toContain("waterpolo.knzb.nl");

    const rsvp = card!.querySelector(".event-rsvp-toggle");
    expect(rsvp?.querySelectorAll("button")).toHaveLength(3);

    const root = viewport as HTMLElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
  });
});
