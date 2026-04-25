import { describe, expect, it } from "vitest";
import {
  findMergeConflictMarkerLines,
  MERGE_CONFLICT_LINE_PREFIXES,
} from "./checkMergeConflictMarkers";

describe("findMergeConflictMarkerLines", () => {
  it("returns empty for clean TSX", () => {
    const src = `
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
`;
    expect(findMergeConflictMarkerLines(src)).toEqual([]);
  });

  it("detects <<<<<<< HEAD at line start", () => {
    const src = `ok\n<<<<<<< HEAD\nother`;
    expect(findMergeConflictMarkerLines(src)).toEqual([2]);
  });

  it("detects ======= separator line", () => {
    const src = "a\n=======\nb";
    expect(findMergeConflictMarkerLines(src)).toEqual([2]);
  });

  it("detects >>>>>>> branch marker", () => {
    const src = "x\n>>>>>>> main\ny";
    expect(findMergeConflictMarkerLines(src)).toEqual([2]);
  });

  it("ignores markers inside code after non-whitespace", () => {
    const src = 'const s = "<<<<<<< not a conflict";';
    expect(findMergeConflictMarkerLines(src)).toEqual([]);
  });

  it("detects indented conflict marker", () => {
    const src = "  \t<<<<<<< HEAD\n";
    expect(findMergeConflictMarkerLines(src)).toEqual([1]);
  });

  it("lists all three sections of a typical conflict", () => {
    const src = `line1
<<<<<<< HEAD
ours
=======
theirs
>>>>>>> branch
`;
    expect(findMergeConflictMarkerLines(src)).toEqual([2, 4, 6]);
  });

  it("detects markers embedded in CSS (same failure mode as PostCss unknown HEAD)", () => {
    const src = `.foo { color: red; }\n<<<<<<< HEAD\n.bar { color: blue; }\n=======\n`;
    expect(findMergeConflictMarkerLines(src)).toEqual([2, 4]);
  });
});

describe("MERGE_CONFLICT_LINE_PREFIXES", () => {
  it("includes the three standard Git markers", () => {
    expect(MERGE_CONFLICT_LINE_PREFIXES).toEqual([
      "<<<<<<<",
      "=======",
      ">>>>>>>",
    ]);
  });
});
