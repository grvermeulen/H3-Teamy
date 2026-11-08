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

async function waitForMaterializedGenerateButton() {
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: /Verslag genereren/i }),
    ).not.toBeDisabled();
  });
}

describe("GenerateReportButton integratie", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("toont NL extract-fout met referentie bij mislukte extract", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/report/extract")) {
        return new Response(
          JSON.stringify({
            error: "openai_failed",
            message: "OpenAI request failed",
            diagnostic: {
              attemptId: "11111111-1111-4111-8111-111111111111",
              requestId: "22222222-2222-4222-8222-222222222222",
              supportRef: "11111111-22222222",
              errorClass: "provider_timeout",
            },
          }),
          {
            status: 502,
            headers: {
              "X-Report-Extract-Request-Id":
                "22222222-2222-4222-8222-222222222222",
            },
          },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GenerateReportButton eventId="evt-1" opponent="De Rijn H3 - Flevo H3" />,
    );
    const fileInput = screen
      .getByRole("button", { name: /Verslag genereren/i })
      .parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(fileInput, {
      target: {
        files: [new File(["x"], "fixture.jpeg", { type: "image/jpeg" })],
      },
    });
    await waitForMaterializedGenerateButton();
    await fireEvent.click(
      screen.getByRole("button", { name: /Verslag genereren/i }),
    );

    await waitFor(() => {
      const text = screen.getByRole("alert").textContent ?? "";
      expect(text).toMatch(/referentie: 11111111-22222222/);
      expect(text).not.toContain("OpenAI");
    });
    const extractCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/report/extract"),
    );
    const init = extractCall?.[1] as RequestInit | undefined;
    const headers = init?.headers;
    const attemptHeader =
      headers instanceof Headers
        ? headers.get("X-Report-Extract-Attempt")
        : (headers as Record<string, string> | undefined)?.[
            "X-Report-Extract-Attempt"
          ];
    expect(attemptHeader).toBeTruthy();
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
      .parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "fixture-screenshot.jpeg", {
      type: "image/jpeg",
    });
    await fireEvent.change(fileInput, { target: { files: [file] } });
    await waitForMaterializedGenerateButton();
    await fireEvent.click(
      screen.getByRole("button", { name: /Verslag genereren/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).toMatch(/screenshot|eindstand|wedstrijdgebeurtenissen/i);
    expect(text).not.toContain("report_input_incomplete");
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).includes("/api/report/generate"),
      ),
    ).toBe(false);
  });
});
