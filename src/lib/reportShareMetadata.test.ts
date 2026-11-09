import { describe, expect, it } from "vitest";
import {
  MATCH_REPORT_PREVIEW_MAX_CHARS,
  buildMatchReportMetadata,
} from "./reportShareMetadata";

describe("buildMatchReportMetadata", () => {
  it("gives WhatsApp a title and the report's opening as preview text", () => {
    const metadata = buildMatchReportMetadata(
      "De Rijn Heren 3 won zaterdag  met 7-5\nvan PFC Rheden.\n\nIn het eerste kwart…",
    );

    expect(metadata.title).toBe("Wedstrijdverslag De Rijn Heren 3");
    expect(metadata.description).toBe(
      "De Rijn Heren 3 won zaterdag met 7-5 van PFC Rheden. In het eerste kwart…",
    );
    expect(metadata.openGraph).toMatchObject({
      type: "article",
      title: "Wedstrijdverslag De Rijn Heren 3",
      description:
        "De Rijn Heren 3 won zaterdag met 7-5 van PFC Rheden. In het eerste kwart…",
    });
  });

  it("cuts a long report at a word boundary", () => {
    const longReport = `${"waterpolo ".repeat(40)}einde`;

    const description = String(
      buildMatchReportMetadata(longReport).description,
    );

    expect(description.length).toBeLessThanOrEqual(
      MATCH_REPORT_PREVIEW_MAX_CHARS,
    );
    expect(description.endsWith("waterpolo…")).toBe(true);
  });
});
