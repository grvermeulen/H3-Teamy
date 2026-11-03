import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryDrill } from "../../lib/speelboek/library";
import type { TrainingProgram } from "../../lib/services/trainingProgramService";
import { DRILLS } from "../../lib/speelboek/drills";
import SpeelboekLibrary from "./SpeelboekLibrary";

const NOW = "2026-11-10T12:00:00Z";
const drills: LibraryDrill[] = DRILLS.map((d) => ({
  ...d,
  source: "static",
  published: true,
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("SpeelboekLibrary", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/trainer/status")) {
        return Promise.resolve(jsonResponse({ isTrainer: false }));
      }
      if (url.endsWith("/api/speelboek/acks")) {
        return Promise.resolve(jsonResponse({ drillIds: ["tip-in"] }));
      }
      return Promise.resolve(jsonResponse({ drills }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists drills grouped by category with a Nieuw section for recent additions", async () => {
    render(
      <SpeelboekLibrary nowIso={NOW} initialDrills={drills} program={null} />,
    );

    expect(screen.getByRole("region", { name: "Nieuw" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Aanval" })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Verdediging" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Tip-in/ })[0]).toHaveAttribute(
      "href",
      "/speelboek/tip-in",
    );
    await waitFor(() =>
      expect(screen.getAllByText(/✓ gesnapt/).length).toBeGreaterThan(0),
    );
    expect(
      screen.queryByRole("link", { name: /Nieuwe oefening/ }),
    ).not.toBeInTheDocument();
  });

  it("filters by category chip", () => {
    render(
      <SpeelboekLibrary nowIso={NOW} initialDrills={drills} program={null} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Keeper" }));
    expect(screen.getByText("Geen oefeningen gevonden")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Techniek" }));
    expect(
      screen.queryByRole("region", { name: "Nieuw" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tip-in/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /4-2 man-meer/ }),
    ).not.toBeInTheDocument();
  });

  it("filters by search query", () => {
    render(
      <SpeelboekLibrary nowIso={NOW} initialDrills={drills} program={null} />,
    );

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Zoek in het speelboek" }),
      { target: { value: "zone" } },
    );

    expect(
      screen.getByRole("link", { name: /Zone 5 tegen 6/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Tip-in/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the upcoming programme and, for trainers, drafts and the new-drill button", async () => {
    const draft: LibraryDrill = {
      ...drills[0],
      id: "concept",
      title: "Conceptoefening",
      source: "trainer",
      published: false,
    };
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/trainer/status")) {
        return Promise.resolve(jsonResponse({ isTrainer: true }));
      }
      if (url.endsWith("/api/speelboek/acks")) {
        return Promise.resolve(jsonResponse({ drillIds: [] }));
      }
      return Promise.resolve(jsonResponse({ drills: [draft, ...drills] }));
    });
    const program: TrainingProgram = {
      date: "2026-11-10",
      items: [
        {
          id: "i1",
          drillId: "tip-in",
          position: 0,
          minutes: 10,
          note: "Met beide handen",
          drill: drills.find((d) => d.id === "tip-in")!,
        },
      ],
    };

    render(
      <SpeelboekLibrary
        nowIso={NOW}
        initialDrills={drills}
        program={program}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Vanavond oefenen we" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Met beide handen")).toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /Nieuwe oefening/ }),
      ).toHaveAttribute("href", "/speelboek/nieuw"),
    );
    expect(screen.getAllByText("Concept").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: /Conceptoefening/ })[0],
    ).toHaveAttribute("href", "/speelboek/concept");
  });
});
