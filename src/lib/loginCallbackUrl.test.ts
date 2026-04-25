import { describe, expect, it } from "vitest";
import { getSafeCallbackUrl } from "./loginCallbackUrl";

describe("getSafeCallbackUrl", () => {
  it("returns slash for empty or missing", () => {
    expect(getSafeCallbackUrl(undefined)).toBe("/");
    expect(getSafeCallbackUrl("")).toBe("/");
    expect(getSafeCallbackUrl("   ")).toBe("/");
  });

  it("allows same-origin relative paths", () => {
    expect(getSafeCallbackUrl("/")).toBe("/");
    expect(getSafeCallbackUrl("/events")).toBe("/events");
    expect(getSafeCallbackUrl("/profile?tab=1")).toBe("/profile?tab=1");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(getSafeCallbackUrl("https://evil.test/x")).toBe("/");
    expect(getSafeCallbackUrl("//evil.test/x")).toBe("/");
    expect(getSafeCallbackUrl("http://evil.test")).toBe("/");
  });

  it("rejects scheme-like path prefixes", () => {
    expect(getSafeCallbackUrl("/javascript:alert(1)")).toBe("/");
  });
});
