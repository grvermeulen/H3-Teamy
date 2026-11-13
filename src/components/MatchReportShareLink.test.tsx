import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MatchReportShareLink from "./MatchReportShareLink";

function sharedText(): string {
  const link = screen.getByRole("link", { name: "Deel in WhatsApp" });
  return (
    new URL(link.getAttribute("href") ?? "").searchParams.get("text") ?? ""
  );
}

describe("MatchReportShareLink", () => {
  afterEach(() => {
    cleanup();
  });

  it("shares the report link from this site with the match result", () => {
    render(
      <MatchReportShareLink
        eventId="evt-1"
        opponentTeam="PFC Rheden H2"
        ourScore={7}
        opponentScore={5}
      />,
    );

    expect(sharedText()).toBe(
      `Wedstrijdverslag van De Rijn Heren 3 tegen PFC Rheden H2 staat klaar (7-5). Lees het hier: ${window.location.origin}/report/evt-1`,
    );
  });

  it("opens WhatsApp in a new tab", () => {
    render(<MatchReportShareLink eventId="evt-1" />);

    const link = screen.getByRole("link", { name: "Deel in WhatsApp" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
