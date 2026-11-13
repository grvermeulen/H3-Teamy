import { describe, expect, it } from "vitest";
import {
  buildMatchReportShareText,
  buildMatchReportUrl,
  buildWhatsAppShareUrl,
} from "./whatsappShare";

describe("buildWhatsAppShareUrl", () => {
  it("opens WhatsApp's chat picker with the text filled in", () => {
    const url = new URL(
      buildWhatsAppShareUrl("Hoi team & co: https://h3.example/x?a=1"),
    );

    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("text")).toBe(
      "Hoi team & co: https://h3.example/x?a=1",
    );
  });
});

describe("buildMatchReportUrl", () => {
  it("links to the report page and escapes the event id", () => {
    expect(
      buildMatchReportUrl("https://h3.example", "2026-11-01 thuis/uit"),
    ).toBe("https://h3.example/report/2026-11-01%20thuis%2Fuit");
  });
});

describe("buildMatchReportShareText", () => {
  it("names the opponent and the score when both are known", () => {
    expect(
      buildMatchReportShareText({
        reportUrl: "https://h3.example/report/evt-1",
        opponentTeam: "PFC Rheden H2",
        ourScore: 7,
        opponentScore: 5,
      }),
    ).toBe(
      "Wedstrijdverslag van De Rijn Heren 3 tegen PFC Rheden H2 staat klaar (7-5). Lees het hier: https://h3.example/report/evt-1",
    );
  });

  it("leaves out the opponent and score when they are unknown", () => {
    expect(
      buildMatchReportShareText({
        reportUrl: "https://h3.example/report/evt-1",
      }),
    ).toBe(
      "Wedstrijdverslag van De Rijn Heren 3 staat klaar. Lees het hier: https://h3.example/report/evt-1",
    );
  });

  it("leaves out a half-known score", () => {
    expect(
      buildMatchReportShareText({
        reportUrl: "https://h3.example/report/evt-1",
        opponentTeam: "PFC Rheden H2",
        ourScore: 7,
      }),
    ).toBe(
      "Wedstrijdverslag van De Rijn Heren 3 tegen PFC Rheden H2 staat klaar. Lees het hier: https://h3.example/report/evt-1",
    );
  });
});
