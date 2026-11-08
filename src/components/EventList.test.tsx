import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventList from "./EventList";

const sessionState = {
  loading: false,
  loggedIn: false,
  isAdmin: false,
  isTrainer: false,
  refresh: async () => {},
};
vi.mock("./SessionContext", () => ({ useSession: () => sessionState }));

vi.mock("./spaceInvaders/SpaceInvadersLauncher", () => ({
  default: () => <div data-testid="space-invaders-launcher" />,
}));

vi.mock("./cityArena/CityArenaLauncher", () => ({
  default: () => <div data-testid="city-arena-launcher" />,
}));

vi.mock("./GenerateReportButton", () => ({
  default: ({ eventId }: { eventId: string }) => (
    <div data-testid={`report-${eventId}`} />
  ),
}));
vi.mock("./ReportPreview", () => ({ default: () => null }));
vi.mock("./MvpVoteButton", () => ({ default: () => null }));

describe("EventList launcher gating", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the Space Invaders card and hides the GTA H3 card by default", async () => {
    render(<EventList events={[]} />);

    // `findBy` awaits EventList's auth-gated load effect so the update isn't left dangling
    // outside of act().
    expect(
      await screen.findByTestId("space-invaders-launcher"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("city-arena-launcher")).toBeNull();
  });

  it("shows the GTA H3 card when the feature is enabled", async () => {
    render(<EventList events={[]} gtaH3Enabled />);

    expect(
      await screen.findByTestId("space-invaders-launcher"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("city-arena-launcher")).toBeInTheDocument();
  });
});

describe("EventList recent wedstrijden", () => {
  const nowMs = new Date("2026-11-07T20:59:00.000Z").getTime();

  beforeEach(() => {
    vi.unstubAllEnvs();
    sessionState.loggedIn = true;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    sessionState.loggedIn = false;
    vi.restoreAllMocks();
  });

  it("hides previous-season fixtures outside the current-season section", async () => {
    vi.stubEnv("SEASON_START", "01-07-2026");
    vi.stubEnv("SEASON_END", "01-07-2027");
    const events = [
      {
        id: "20260418--dos",
        title: "DOS H1 - De Rijn H3",
        start: "2026-04-18T12:00:00.000Z",
      },
      {
        id: "20261114--next",
        title: "Volgende wedstrijd",
        start: "2026-11-14T17:00:00.000Z",
      },
    ];
    render(<EventList events={events} nowMs={nowMs} />);
    expect(
      await screen.findByRole("heading", { name: /Dit seizoen \(2026/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Volgende wedstrijd")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: /Dit seizoen \(2026/ });
    const currentSection = heading.parentElement;
    expect(currentSection).not.toBeNull();
    expect(
      within(currentSection as HTMLElement).queryByText("DOS H1 - De Rijn H3"),
    ).toBeNull();
    expect(screen.getByText(/Vorig seizoen \(2025/)).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("lists the last three completed matches and today's fixture with report entry", async () => {
    vi.stubEnv("SEASON_START", "01-07-2026");
    vi.stubEnv("SEASON_END", "01-07-2027");
    const events = [
      {
        id: "20261024--a",
        title: "Wedstrijd A",
        start: "2026-10-24T17:50:00.000Z",
      },
      {
        id: "20261031--b",
        title: "Wedstrijd B",
        start: "2026-10-31T17:50:00.000Z",
      },
      {
        id: "20261107--today",
        title: "Wedstrijd vandaag",
        start: "2026-11-07T17:50:00.000Z",
        end: "2026-11-07T19:50:00.000Z",
      },
      {
        id: "20261114--next",
        title: "Volgende wedstrijd",
        start: "2026-11-14T17:00:00.000Z",
      },
    ];
    render(<EventList events={events} nowMs={nowMs} />);
    expect(await screen.findByText("Wedstrijd vandaag")).toBeInTheDocument();
    expect(screen.getByText("Wedstrijd A")).toBeInTheDocument();
    expect(screen.getByText("Volgende wedstrijd")).toBeInTheDocument();
    expect(screen.getByTestId("report-20261107--today")).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("offers report actions on previous-season fixtures in the collapsed block", async () => {
    vi.stubEnv("SEASON_START", "01-07-2026");
    vi.stubEnv("SEASON_END", "01-07-2027");
    render(
      <EventList
        events={[
          {
            id: "20260418--dos",
            title: "DOS H1 - De Rijn H3",
            start: "2026-04-18T12:00:00.000Z",
          },
        ]}
        nowMs={nowMs}
      />,
    );
    const summary = await screen.findByText(/Vorig seizoen/);
    summary.click();
    expect(screen.getByText("DOS H1 - De Rijn H3")).toBeInTheDocument();
    expect(screen.getByTestId("report-20260418--dos")).toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});
