import { describe, expect, it } from "vitest";
import { findMergeConflictMarkerOccurrences, lineHasMergeConflictMarker } from "./mergeConflictMarkers";

describe("lineHasMergeConflictMarker", () => {
  it("returns false for normal code", () => {
    expect(lineHasMergeConflictMarker("const x = 1;")).toBe(false);
    expect(lineHasMergeConflictMarker("")).toBe(false);
  });

  it("detects opening conflict marker", () => {
    expect(lineHasMergeConflictMarker("<<<<<<< HEAD")).toBe(true);
    expect(lineHasMergeConflictMarker("  <<<<<<< branch")).toBe(true);
  });

  it("detects middle marker", () => {
    expect(lineHasMergeConflictMarker("=======")).toBe(true);
    expect(lineHasMergeConflictMarker("\t=======")).toBe(true);
  });

  it("detects closing conflict marker", () => {
    expect(lineHasMergeConflictMarker(">>>>>>> origin/image")).toBe(true);
  });
});

describe("findMergeConflictMarkerOccurrences", () => {
  it("returns empty when no markers", () => {
    expect(findMergeConflictMarkerOccurrences("export const a = 1;\n", "a.ts")).toEqual([]);
  });

  it("returns labelled line numbers for each marker line", () => {
    const src = "ok\n<<<<<<< X\n=======\n>>>>>>> Y\n";
    expect(findMergeConflictMarkerOccurrences(src, "f.tsx")).toEqual(["f.tsx:2", "f.tsx:3", "f.tsx:4"]);
  });
});
