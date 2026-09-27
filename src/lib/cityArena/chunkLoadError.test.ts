import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "./chunkLoadError";

describe("isChunkLoadError", () => {
  it("recognises webpack's and Turbopack's ChunkLoadError by name", () => {
    const error = new Error("Failed to load chunk /_next/static/chunks/3d.js");
    error.name = "ChunkLoadError";
    expect(isChunkLoadError(error)).toBe(true);
  });

  it.each([
    "Loading chunk render3d failed.",
    "Failed to fetch dynamically imported module: https://x/_next/3d.js",
    "Importing a module script failed.",
    "error loading dynamically imported module",
  ])("recognises a failed native import by its message: %s", (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it("leaves real errors, and things that are not errors, alone", () => {
    expect(isChunkLoadError(new Error("shader compile failed"))).toBe(false);
    expect(isChunkLoadError("ChunkLoadError")).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
