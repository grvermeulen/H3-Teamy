import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GenerateReportButton from "./GenerateReportButton";

const sessionState = {
  loading: false,
  loggedIn: true,
  isAdmin: true,
  isTrainer: false,
  refresh: async () => {},
};

vi.mock("./SessionContext", () => ({ useSession: () => sessionState }));

describe("GenerateReportButton integratie", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("blokkeert generate bij incomplete extract; geen raw JSON", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/report/extract")) {
        return new Response(
          JSON.stringify({
            result: {
              homeTeam: "De Rijn 3",
              awayTeam: "Onbekende tegenstander",
            },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GenerateReportButton
        eventId="evt-1"
        opponent="PFC Rheden H2-De Rijn H3"
      />,
    );

    const fileInput = screen
      .getByRole("button", { name: /Verslag genereren/i })
      .parentElement!.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
    const file = new File(["x"], "fixture-screenshot.jpeg", {
      type: "image/jpeg",
    });
    await fireEvent.change(fileInput, { target: { files: [file] } });
    await fireEvent.click(screen.getByRole("button", { name: /Verslag genereren/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).toMatch(/screenshot|eindstand|wedstrijdgebeurtenissen/i);
    expect(text).not.toContain("report_input_incomplete");
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/report/generate")),
    ).toBe(false);
  });
});
