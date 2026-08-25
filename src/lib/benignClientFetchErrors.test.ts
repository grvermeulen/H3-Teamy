import { describe, expect, it } from "vitest";
import { isBenignTransientClientFetchError } from "./benignClientFetchErrors";

describe("isBenignTransientClientFetchError", () => {
  it("returns true for WebKit Load failed TypeError", () => {
    expect(
      isBenignTransientClientFetchError(new TypeError("Load failed")),
    ).toBe(true);
  });

  it("returns true for Chromium Failed to fetch TypeError", () => {
    expect(
      isBenignTransientClientFetchError(new TypeError("Failed to fetch")),
    ).toBe(true);
  });

  it("returns true for Firefox NetworkError when attempting to fetch resource", () => {
    expect(
      isBenignTransientClientFetchError(
        new TypeError("NetworkError when attempting to fetch resource."),
      ),
    ).toBe(true);
  });

  it("returns true for DOMException NetworkError (A network error occurred)", () => {
    expect(
      isBenignTransientClientFetchError(
        new DOMException("A network error occurred.", "NetworkError"),
      ),
    ).toBe(true);
  });

  it("returns true for Error with A network error occurred message", () => {
    expect(
      isBenignTransientClientFetchError(
        new Error("A network error occurred."),
      ),
    ).toBe(true);
  });

  it("returns true when benign error is nested in error cause", () => {
    const inner = new DOMException("A network error occurred.", "NetworkError");
    const wrapped = new Error("wrapped");
    Object.assign(wrapped, { cause: inner });
    expect(isBenignTransientClientFetchError(wrapped)).toBe(true);
  });

  it("returns false for unexpected application errors", () => {
    expect(
      isBenignTransientClientFetchError(new Error("feedback POST failed: 500")),
    ).toBe(false);
  });
});
