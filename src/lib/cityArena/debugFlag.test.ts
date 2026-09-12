import { describe, expect, it } from "vitest";
import { isDebugEnabled } from "./debugFlag";

describe("isDebugEnabled", () => {
  it("is on only with ?debug=1 outside production", () => {
    expect(isDebugEnabled("?debug=1", "development")).toBe(true);
    expect(isDebugEnabled("?foo=1&debug=1", "test")).toBe(true);
    expect(isDebugEnabled("?debug=1", "production")).toBe(false);
    expect(isDebugEnabled("", "development")).toBe(false);
    expect(isDebugEnabled("?debug=0", undefined)).toBe(false);
  });
});
