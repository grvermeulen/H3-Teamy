import { describe, expect, it } from "vitest";
import { extractTeamsFromEventTitle } from "./matchTitleTeams";

describe("extractTeamsFromEventTitle", () => {
  it("splitst Sportlink-titels met spaties rond het streepje", () => {
    expect(
      extractTeamsFromEventTitle("NDD H3 - De Rijn H3"),
    ).toEqual({ home: "NDD H3", away: "De Rijn H3" });
    expect(
      extractTeamsFromEventTitle("De Rijn H3 - Flevo H3"),
    ).toEqual({ home: "De Rijn H3", away: "Flevo H3" });
  });

  it("splitst compacte titel zonder spaties vóór De Rijn", () => {
    expect(
      extractTeamsFromEventTitle("PFC Rheden H2-De Rijn H3"),
    ).toEqual({ home: "PFC Rheden H2", away: "De Rijn H3" });
  });

  it("splitst niet op streepjes binnen een poulecode", () => {
    expect(extractTeamsFromEventTitle("NDD/De Gendten H4")).toBeNull();
  });
});
