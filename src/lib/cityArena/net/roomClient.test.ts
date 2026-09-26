import { describe, expect, it } from "vitest";
import {
  ArenaRequestError,
  shouldReportArenaRequestError,
} from "./roomClient";

describe("shouldReportArenaRequestError", () => {
  it("returns false for expected client refusals", () => {
    expect(
      shouldReportArenaRequestError(new ArenaRequestError("Log in", 401)),
    ).toBe(false);
    expect(
      shouldReportArenaRequestError(new ArenaRequestError("Geen toegang", 403)),
    ).toBe(false);
    expect(
      shouldReportArenaRequestError(new ArenaRequestError("Vol", 409)),
    ).toBe(false);
  });

  it("returns false for infrastructure outages", () => {
    expect(
      shouldReportArenaRequestError(
        new ArenaRequestError("Database tijdelijk niet beschikbaar", 503),
      ),
    ).toBe(false);
  });

  it("returns true for unexpected server failures", () => {
    expect(
      shouldReportArenaRequestError(
        new ArenaRequestError("Interne fout", 500),
      ),
    ).toBe(true);
    expect(shouldReportArenaRequestError(new Error("boom"))).toBe(true);
  });
});
