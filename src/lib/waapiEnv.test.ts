import { describe, expect, it } from "vitest";
import { buildWaapiJsonHeaders, normalizeWaapiApiToken } from "./waapiEnv";

describe("normalizeWaapiApiToken", () => {
  it("strips a Bearer prefix", () => {
    expect(normalizeWaapiApiToken("Bearer abc-token")).toBe("abc-token");
  });

  it("strips wrapping double quotes", () => {
    expect(normalizeWaapiApiToken('"abc-token"')).toBe("abc-token");
  });

  it("leaves a plain token unchanged", () => {
    expect(normalizeWaapiApiToken("plain-token")).toBe("plain-token");
  });
});

describe("buildWaapiJsonHeaders", () => {
  it("includes Accept and Authorization", () => {
    expect(buildWaapiJsonHeaders("tok")).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer tok",
    });
  });
});
