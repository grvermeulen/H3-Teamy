import { describe, expect, it } from "vitest";
import { isLockfilePath, summarizeLockfileChanges } from "./lockfileSummary";

describe("isLockfilePath", () => {
  it("recognizes npm and python lockfiles", () => {
    expect(isLockfilePath("package-lock.json")).toBe(true);
    expect(isLockfilePath("requirements.txt")).toBe(true);
    expect(isLockfilePath("src/foo.ts")).toBe(false);
  });
});

describe("summarizeLockfileChanges", () => {
  it("extracts package version bumps from package-lock hunks", () => {
    const patch = [
      '-    "lodash": {',
      '+    "lodash": {',
      '-      "version": "4.17.20",',
      '+      "version": "4.17.21",',
    ].join("\n");
    const summary = summarizeLockfileChanges("package-lock.json", patch);
    expect(summary).toContain("lodash");
  });

  it("extracts requirements.txt line changes", () => {
    const patch = "-requests==2.28.0\n+requests==2.31.0";
    const summary = summarizeLockfileChanges("requirements.txt", patch);
    expect(summary.some((s) => s.includes("requests"))).toBe(true);
  });
});
