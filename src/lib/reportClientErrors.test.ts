import { describe, expect, it } from "vitest";
import {
  formatReportExtractClientError,
  formatReportGenerateError,
} from "./reportClientErrors";

describe("formatReportGenerateError", () => {
  it("vertaalt report_input_incomplete naar NL zonder JSON dump", () => {
    const msg = formatReportGenerateError(
      422,
      JSON.stringify({
        error: "report_input_incomplete",
        message: "Ontbrekende score of events",
        received: { homeTeam: "x" },
      }),
    );
    expect(msg).toBe("Ontbrekende score of events");
    expect(msg).not.toContain("received");
  });
});

describe("formatReportExtractClientError", () => {
  const diagnostic = {
    attemptId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    supportRef: "11111111-22222222",
    errorClass: "provider_timeout",
  };

  it("toont referentie bij HTTP-providerfout zonder ruwe info", () => {
    const msg = formatReportExtractClientError({
      kind: "http",
      httpStatus: 502,
      bodyText: JSON.stringify({
        error: "openai_failed",
        message: "OpenAI request failed",
        diagnostic,
      }),
    });
    expect(msg).toMatch(/referentie: 11111111-22222222/);
    expect(msg).toMatch(/duurde te lang/);
    expect(msg).not.toContain("Gateway");
    expect(msg).not.toContain("sk-");
  });

  it("onderscheidt non-json gateway antwoord", () => {
    const msg = formatReportExtractClientError({
      kind: "non_json",
      httpStatus: 504,
      diagnostic,
    });
    expect(msg).toMatch(/onverwacht antwoord|time-out/i);
  });

  it("toont netwerk- en abortmelding", () => {
    expect(
      formatReportExtractClientError({ kind: "network", diagnostic }),
    ).toMatch(/Geen verbinding/);
    expect(
      formatReportExtractClientError({ kind: "abort", diagnostic }),
    ).toMatch(/afgebroken/);
  });
});
