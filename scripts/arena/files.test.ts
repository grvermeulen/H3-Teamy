import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isMissing, listIfPresent, readIfPresent, writeAtomic } from "./files";

describe("audio script file helpers", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "arena-files-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("tells a missing path from any other failure", () => {
    const missing = Object.assign(new Error("gone"), { code: "ENOENT" });
    const refused = Object.assign(new Error("no"), { code: "EACCES" });
    expect(isMissing(missing)).toBe(true);
    expect(isMissing(refused)).toBe(false);
    expect(isMissing("ENOENT")).toBe(false);
  });

  it("reads a file that is there, null for one that is not, and throws for a directory", async () => {
    await writeFile(path.join(dir, "a.txt"), "hoi");
    expect(await readIfPresent(path.join(dir, "a.txt"))).toBe("hoi");
    expect(await readIfPresent(path.join(dir, "b.txt"))).toBeNull();
    await expect(readIfPresent(dir)).rejects.toThrow();
  });

  it("lists a directory that is there and nothing for one that is not", async () => {
    await writeFile(path.join(dir, "a.mp3"), "ID3");
    expect(await listIfPresent(dir)).toEqual(["a.mp3"]);
    expect(await listIfPresent(path.join(dir, "nope"))).toEqual([]);
  });

  it("writes atomically, creating the directory and leaving no temporary file", async () => {
    const file = path.join(dir, "deep", "manifest.json");
    await writeAtomic(file, "{}");
    await writeAtomic(file, '{"v":2}');
    expect(await readFile(file, "utf8")).toBe('{"v":2}');
    expect(await readdir(path.dirname(file))).toEqual(["manifest.json"]);
  });
});
