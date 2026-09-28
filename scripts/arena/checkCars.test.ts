import { describe, expect, it } from "vitest";
import { CAR_BUDGET_BYTES, auditCars, carManifestFiles } from "./check-cars";
import { fixtureAtlas, fixtureCar } from "./carFixture";
import { buildCarManifest, carCredits, packCarGeometry } from "./packCars";
import { CAR_SOURCES } from "./carSources";
import type { PackFs } from "./packAudit";

const MANIFEST = buildCarManifest(
  CAR_SOURCES.map((source) =>
    packCarGeometry(fixtureCar(), source, fixtureAtlas()),
  ),
);
const CREDITS = carCredits(CAR_SOURCES);

/** A directory holding `sizes`; `stat` of anything else is a missing file. */
function fakeFs(sizes: Record<string, number>): PackFs {
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
    carManifestFiles(MANIFEST).map((file) => [file, size]),
  );
}

describe("auditCars", () => {
  it("is quiet when every file is present, credited and within budget", async () => {
    expect(
      await auditCars("dir", MANIFEST, CREDITS, fakeFs(allFiles(1000))),
    ).toEqual([]);
  });

  it("names a missing file, a stray model and an uncredited one", async () => {
    const sizes = allFiles(1000);
    delete sizes["van.glb"];
    sizes["taxi.glb"] = 10;
    const credits = CREDITS.replace(/\| police\.glb \|.*\n/, "");
    const problems = await auditCars("dir", MANIFEST, credits, fakeFs(sizes));
    expect(problems).toEqual(
      expect.arrayContaining([
        { file: "van.glb", problem: "no such file" },
        { file: "taxi.glb", problem: "not in manifest.json" },
        { file: "police.glb", problem: "no row in CREDITS.md" },
      ]),
    );
  });

  it("flags a set over the budget", async () => {
    const each =
      Math.ceil(CAR_BUDGET_BYTES / carManifestFiles(MANIFEST).length) + 1;
    const problems = await auditCars(
      "dir",
      MANIFEST,
      CREDITS,
      fakeFs(allFiles(each)),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toMatch(/over the 1536 KB budget/);
  });
});
