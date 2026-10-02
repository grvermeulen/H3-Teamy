import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatEventDate,
  formatEventTime,
  formatLongDate,
} from "./datetime";

describe("Dutch event display", () => {
  it("shows Amsterdam summer and winter kickoff times", () => {
    expect(formatEventTime("2026-10-10T16:40:00Z")).toBe("18:40");
    expect(
      formatEventTime("2026-11-07T17:50:00Z", "2026-11-07T19:50:00Z"),
    ).toBe("18:50 – 20:50");
  });

  it("uses the Dutch calendar date when UTC is still the previous day", () => {
    const start = "2026-10-09T22:30:00Z";
    expect(formatEventDate(start)).toBe("za 10 okt");
    expect(formatLongDate(start)).toBe("zaterdag 10 oktober");
    expect(formatDateTime(start)).toMatch(/^10-10-2026,? 00:30$/);
  });
});
