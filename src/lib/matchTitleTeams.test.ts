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

  it("respecteert normale streepjes in clubnamen bij spatie-gescheiden titel", () => {
    expect(
      extractTeamsFromEventTitle("Some Club H2 - Other Club H3"),
    ).toEqual({ home: "Some Club H2", away: "Other Club H3" });
  });

  it("splitst compacte De-Rijn-thuis en ENC-uit variant", () => {
    expect(extractTeamsFromEventTitle("De Rijn H3-ENC Arnhem H4")).toEqual({
      home: "De Rijn H3",
      away: "ENC Arnhem H4",
    });
  });

  it("geeft null bij dubbelzinnige titel zonder herkenbare scheiding", () => {
    expect(extractTeamsFromEventTitle("wedstrijd zonder teams")).toBeNull();
  });
});
