import { describe, expect, it } from "vitest";
import { formatReportGenerateError } from "./reportClientErrors";

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
