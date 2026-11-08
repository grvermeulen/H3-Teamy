import { describe, expect, it } from "vitest";
import { extractTeamsFromEventTitle } from "./matchTitleTeams";
import {
  extractedTeamsMismatchFixture,
  extractHasScoresAndEvents,
  teamNamesLikelyMatch,
} from "./reportExtractValidation";

describe("reportExtractValidation", () => {
  it("herkent OCR H3-varianten van De Rijn", () => {
    expect(teamNamesLikelyMatch("De Rijn H3", "De Rijn 3")).toBe(true);
  });

  it("detecteert mismatch tussen fixture en extract", () => {
    const titleTeams = extractTeamsFromEventTitle("PFC Rheden H2 - De Rijn H3");
    expect(
      extractedTeamsMismatchFixture(titleTeams, {
        homeTeam: "Andere Club H1",
        awayTeam: "Nog een team",
      }),
    ).toBe(true);
  });

  it("accepteert volledige extract voor fixture", () => {
    expect(
      extractHasScoresAndEvents({
        homeScore: 10,
        awayScore: 8,
        events: [{ quarter: 1, team: "home", type: "goal" }],
      }),
    ).toBe(true);
    expect(
      extractHasScoresAndEvents({
        homeScore: 10,
        homeTeam: "A",
      }),
    ).toBe(false);
  });
});
