import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RadioManifest } from "../../src/lib/cityArena/audio/radio/stations";
import { RADIO_LIMITS, auditRadio } from "./check-radio";
import { creditsFile } from "./credits";

const MANIFEST: RadioManifest = {
  version: 1,
  stations: [
    {
      id: "a",
      name: "A FM",
      tracks: [{ file: "a-1-00000000.mp3", title: "Een", seconds: 120 }],
    },
    {
      id: "b",
      name: "B FM",
      tracks: [
        { file: "b-1-00000000.mp3", title: "Twee", seconds: 120 },
        { file: "b-2-00000000.mp3", title: "Drie", seconds: 120 },
      ],
    },
  ],
};
const FILES = MANIFEST.stations.flatMap((station) =>
  station.tracks.map((track) => track.file),
);

/** A credits table naming every file given. */
function creditsFor(files: string[]): string {
  return creditsFile(
    "Radio credits",
    "test",
    files.map((file) => `| ${file} | somewhere | someone | CC0 | https://x |`),
  );
}

describe("auditRadio", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "arena-radio-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is quiet when every track has a small file and a credit row", async () => {
    for (const file of FILES) await writeFile(path.join(dir, file), "ID3");
    expect(await auditRadio(dir, MANIFEST, creditsFor(FILES), FILES)).toEqual(
      [],
    );
  });

  it("names a missing file, an uncredited track, an oversized track and an orphan", async () => {
    for (const file of FILES)
      if (file !== "b-2-00000000.mp3")
        await writeFile(path.join(dir, file), "ID3");
    await writeFile(
      path.join(dir, "a-1-00000000.mp3"),
      Buffer.alloc(RADIO_LIMITS.trackBytes + 1),
    );
    await writeFile(path.join(dir, "old-9-00000000.mp3"), "ID3");
    const present = [
      "a-1-00000000.mp3",
      "b-1-00000000.mp3",
      "old-9-00000000.mp3",
    ];
    const problems = await auditRadio(
      dir,
      MANIFEST,
      creditsFor(FILES.filter((file) => file !== "b-1-00000000.mp3")),
      present,
    );
    expect(problems).toContainEqual({
      file: "b-2-00000000.mp3",
      problem: "no such file",
    });
    expect(problems).toContainEqual({
      file: "b-1-00000000.mp3",
      problem: "no row in CREDITS.md",
    });
    expect(problems).toContainEqual({
      file: "a-1-00000000.mp3",
      problem: expect.stringContaining("over the"),
    });
    expect(problems).toContainEqual({
      file: "old-9-00000000.mp3",
      problem: "not in stations.json",
    });
    expect(problems).toHaveLength(4);
  });

  it("flags a set over the budget even when each track is under its cap", async () => {
    const limits = { trackBytes: 4096, totalBytes: 6000 };
    for (const file of FILES)
      await writeFile(path.join(dir, file), Buffer.alloc(2500));
    const problems = await auditRadio(
      dir,
      MANIFEST,
      creditsFor(FILES),
      FILES,
      limits,
    );
    expect(problems).toEqual([
      { file: "(all tracks)", problem: expect.stringContaining("over the") },
    ]);
  });

  it("treats a missing credits file as nothing credited, and an empty dial as fine", async () => {
    expect(
      await auditRadio(dir, { version: 1, stations: [] }, null, []),
    ).toEqual([]);
    const problems = await auditRadio(dir, MANIFEST, null, []);
    expect(
      problems.filter((problem) => problem.problem === "no row in CREDITS.md"),
    ).toHaveLength(3);
  });
});
