import { describe, it, expect } from "vitest";
import { CHANGELOG, getChangelogEntry } from "./changelog";

describe("changelog", () => {
  it("returns null for unknown version", () => {
    expect(getChangelogEntry("9.9.9")).toBeNull();
  });

  it("contains the 0.2.0 entry with at least one step", () => {
    const entry = getChangelogEntry("0.2.0");
    expect(entry).not.toBeNull();
    expect(entry?.steps.length).toBeGreaterThan(0);
    expect(typeof entry?.title).toBe("string");
  });

  it("each step has a title and body", () => {
    for (const [, entry] of Object.entries(CHANGELOG)) {
      for (const step of entry.steps) {
        expect(step.title.length).toBeGreaterThan(0);
        expect(step.body.length).toBeGreaterThan(0);
      }
    }
  });
});
