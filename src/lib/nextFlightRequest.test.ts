import { describe, expect, it } from "vitest";
import {
  isNextAppRouterFlightFetch,
  shouldDropStaleFlightRouterStateTree,
} from "./nextFlightRequest";

describe("isNextAppRouterFlightFetch", () => {
  it("returns true for root path with _rsc query", () => {
    expect(
      isNextAppRouterFlightFetch({
        pathname: "/",
        hasRscQuery: true,
        rscHeader: null,
      }),
    ).toBe(true);
  });

  it("returns true when rsc header is 1", () => {
    expect(
      isNextAppRouterFlightFetch({
        pathname: "/kalender",
        hasRscQuery: false,
        rscHeader: "1",
      }),
    ).toBe(true);
  });

  it("returns false for API routes even with _rsc", () => {
    expect(
      isNextAppRouterFlightFetch({
        pathname: "/api/rsvp/list",
        hasRscQuery: true,
        rscHeader: null,
      }),
    ).toBe(false);
  });

  it("returns false for _next static paths", () => {
    expect(
      isNextAppRouterFlightFetch({
        pathname: "/_next/static/chunks/foo.js",
        hasRscQuery: true,
        rscHeader: null,
      }),
    ).toBe(false);
  });

  it("returns false without flight markers", () => {
    expect(
      isNextAppRouterFlightFetch({
        pathname: "/",
        hasRscQuery: false,
        rscHeader: null,
      }),
    ).toBe(false);
  });
});

describe("shouldDropStaleFlightRouterStateTree", () => {
  it("matches flight detection for app paths", () => {
    expect(
      shouldDropStaleFlightRouterStateTree({
        pathname: "/",
        hasRscQuery: true,
        rscHeader: null,
      }),
    ).toBe(true);
  });

  it("is false when not a flight fetch", () => {
    expect(
      shouldDropStaleFlightRouterStateTree({
        pathname: "/privacy",
        hasRscQuery: false,
        rscHeader: null,
      }),
    ).toBe(false);
  });
});
