import { describe, expect, it } from "vitest";
import {
  CHARACTER_BUDGET_BYTES,
  auditCharacters,
  manifestFiles,
  type CharacterFs,
} from "./check-characters";
import {
  CHARACTER_SOURCES,
  buildManifest,
  characterCredits,
  clipRolesFrom,
} from "./packCharacters";

const CLIPS = clipRolesFrom([
  "Idle",
  "Walk",
  "Run",
  "Death",
  "Punch_Right",
  "Idle_Gun_Pointing",
  "Gun_Shoot",
  "Sword_Slash",
]);

const MANIFEST = buildManifest(
  CHARACTER_SOURCES.map((entry) => ({
    entry,
    materials: ["Skin"],
    colours: [0xba9c79],
    height: 1.86,
    bytes: 0,
  })),
  [
    { rig: "men", clips: CLIPS, bytes: 0 },
    { rig: "women", clips: CLIPS, bytes: 0 },
  ],
);

const CREDITS = characterCredits(CHARACTER_SOURCES);

/** A directory holding `sizes`; `stat` of anything else is a missing file. */
function fakeFs(sizes: Record<string, number>): CharacterFs {
  return {
    async stat(file) {
      const name = file.split(/[\\/]/).pop() ?? file;
      if (name in sizes) return { size: sizes[name] };
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    async list() {
      return [...Object.keys(sizes), "manifest.json", "CREDITS.md"];
    },
  };
}

/** Every manifest file at `size` bytes. */
function allFiles(size: number): Record<string, number> {
  return Object.fromEntries(
    manifestFiles(MANIFEST).map((file) => [file, size]),
  );
}

describe("auditCharacters", () => {
  it("is quiet when every file is present, credited and within budget", async () => {
    expect(
      await auditCharacters("dir", MANIFEST, CREDITS, fakeFs(allFiles(1000))),
    ).toEqual([]);
  });

  it("names a missing file, a stray model and an uncredited one", async () => {
    const sizes = allFiles(1000);
    delete sizes["swat.glb"];
    sizes["extra.glb"] = 10;
    const credits = CREDITS.replace(/\| punk-man\.glb \|.*\n/, "");
    const problems = await auditCharacters(
      "dir",
      MANIFEST,
      credits,
      fakeFs(sizes),
    );
    expect(problems).toContainEqual({
      file: "swat.glb",
      problem: "no such file",
    });
    expect(problems).toContainEqual({
      file: "extra.glb",
      problem: "not in manifest.json",
    });
    expect(problems).toContainEqual({
      file: "punk-man.glb",
      problem: "no row in CREDITS.md",
    });
  });

  it("flags a set over the budget", async () => {
    const each =
      Math.ceil(CHARACTER_BUDGET_BYTES / manifestFiles(MANIFEST).length) + 1;
    const problems = await auditCharacters(
      "dir",
      MANIFEST,
      CREDITS,
      fakeFs(allFiles(each)),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toMatch(/over the 3072 KB budget/);
  });

  it("flags a file credited twice", async () => {
    const row = CREDITS.split("\n").find((line) =>
      line.startsWith("| swat.glb"),
    );
    const problems = await auditCharacters(
      "dir",
      MANIFEST,
      `${CREDITS}${row}\n`,
      fakeFs(allFiles(1000)),
    );
    expect(problems).toEqual([
      { file: "swat.glb", problem: "credited twice in CREDITS.md" },
    ]);
  });

  it("surfaces a read failure other than a missing file", async () => {
    const fs: CharacterFs = {
      ...fakeFs(allFiles(1000)),
      stat: async () => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      },
    };
    await expect(auditCharacters("dir", MANIFEST, CREDITS, fs)).rejects.toThrow(
      "EACCES",
    );
  });
});
