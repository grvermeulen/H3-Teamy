import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { isAppRouterRscRequest } from "./middlewareRsc";

describe("isAppRouterRscRequest", () => {
  it("returns true when _rsc query param is present", () => {
    const req = new NextRequest("https://example.com/?_rsc=cgn5j");
    expect(isAppRouterRscRequest(req)).toBe(true);
  });

  it("returns false for normal document navigation", () => {
    const req = new NextRequest("https://example.com/");
    expect(isAppRouterRscRequest(req)).toBe(false);
  });

  it("returns false for other query params", () => {
    const req = new NextRequest("https://example.com/?foo=bar");
    expect(isAppRouterRscRequest(req)).toBe(false);
  });
});
