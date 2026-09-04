import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import { isMainModule } from "./utils.ts";

describe("isMainModule", () => {
  it("is true for the module that started the process", () => {
    expect(isMainModule(pathToFileURL(process.argv[1]).href)).toBe(true);
  });

  it("is false for an imported module", () => {
    expect(isMainModule(import.meta.url)).toBe(false);
  });
});
