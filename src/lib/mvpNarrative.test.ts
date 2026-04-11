import { describe, expect, it } from "vitest";
import {
  applyMvpResultLine,
  formatMvpResultLine,
  MVP_PLACEHOLDER,
  reinstateMvpPlaceholder,
} from "./mvpNarrative";

describe("mvpNarrative", () => {
  it("formatMvpResultLine bouwt zin met naam en percentages", () => {
    expect(formatMvpResultLine("Jan", 40, 10)).toBe(
      "Onze MVP: Jan (40% van 10 stemmen).",
    );
  });

  it("applyMvpResultLine met lege content retourneert alleen resultaatregel", () => {
    expect(
      applyMvpResultLine(undefined, "Onze MVP: X (100% van 1 stemmen)."),
    ).toBe("Onze MVP: X (100% van 1 stemmen).");
  });

  it("applyMvpResultLine vervangt placeholder", () => {
    const base = `Tekst\n${MVP_PLACEHOLDER}`;
    const line = formatMvpResultLine("Piet", 50, 4);
    expect(applyMvpResultLine(base, line)).toContain("Piet");
    expect(applyMvpResultLine(base, line)).not.toContain(MVP_PLACEHOLDER);
  });

  it("applyMvpResultLine voegt toe als geen placeholder", () => {
    const out = applyMvpResultLine("bestaand", "nieuw");
    expect(out).toContain("bestaand");
    expect(out).toContain("nieuw");
  });

  it("reinstateMvpPlaceholder met lege content", () => {
    expect(reinstateMvpPlaceholder(undefined)).toBe(MVP_PLACEHOLDER);
  });

  it("reinstateMvpPlaceholder laat placeholder ongemoeid", () => {
    expect(reinstateMvpPlaceholder(MVP_PLACEHOLDER)).toBe(MVP_PLACEHOLDER);
  });

  it("reinstateMvpPlaceholder vervangt resultaatregel", () => {
    const s = "Rapport\nOnze MVP: Jan (10% van 2 stemmen).";
    expect(reinstateMvpPlaceholder(s)).toContain(MVP_PLACEHOLDER);
  });

  it("reinstateMvpPlaceholder voegt placeholder toe als geen match", () => {
    const s = "Alleen rapport";
    expect(reinstateMvpPlaceholder(s)).toContain(MVP_PLACEHOLDER);
    expect(reinstateMvpPlaceholder(s)).toContain("Alleen rapport");
  });
});
