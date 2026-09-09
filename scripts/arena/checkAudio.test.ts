import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIO_CLIPS, CLIP_NAMES } from "../../src/lib/cityArena/audio/clips";
import { MAX_CLIP_BYTES, auditAudio } from "./check-audio";

/** A credits table naming every clip in the table. */
function creditsFor(files: string[]): string {
  return [
    "| File | Source | Author | Licence | URL |",
    "| --- | --- | --- | --- | --- |",
    ...files.map(
      (file) => `| ${file} | somewhere | someone | CC0 | https://x |`,
    ),
  ].join("\n");
}

describe("auditAudio", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "arena-audio-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is quiet when every clip has a small file and a credit row", async () => {
    for (const clip of CLIP_NAMES)
      await writeFile(path.join(dir, AUDIO_CLIPS[clip].file), "ID3");
    const credits = creditsFor(
      CLIP_NAMES.map((clip) => AUDIO_CLIPS[clip].file),
    );
    expect(await auditAudio(dir, credits)).toEqual([]);
  });

  it("names a missing file, an uncredited file and an oversized one", async () => {
    for (const clip of CLIP_NAMES)
      if (clip !== "siren")
        await writeFile(path.join(dir, AUDIO_CLIPS[clip].file), "ID3");
    await writeFile(
      path.join(dir, AUDIO_CLIPS.engine.file),
      Buffer.alloc(MAX_CLIP_BYTES + 1),
    );
    const credited = CLIP_NAMES.filter((clip) => clip !== "pickup").map(
      (clip) => AUDIO_CLIPS[clip].file,
    );
    const problems = await auditAudio(dir, creditsFor(credited));
    expect(problems).toContainEqual({
      file: "siren.mp3",
      problem: "no such file",
    });
    expect(problems).toContainEqual({
      file: "pickup.mp3",
      problem: "no row in CREDITS.md",
    });
    expect(problems).toContainEqual({
      file: "engine.mp3",
      problem: expect.stringContaining("over the"),
    });
    expect(problems).toHaveLength(3);
  });

  it("treats a missing credits file as nothing credited", async () => {
    const problems = await auditAudio(dir, null);
    expect(
      problems.filter((p) => p.problem === "no row in CREDITS.md"),
    ).toHaveLength(CLIP_NAMES.length);
  });
});
