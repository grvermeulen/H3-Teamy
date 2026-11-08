import { describe, expect, it } from "vitest";
import {
  isBenignNonJsonOkResponseBody,
  isBenignNonJsonOkResponseContentType,
} from "./benignNonJsonOkResponse";

describe("isBenignNonJsonOkResponseBody", () => {
  it("returns true for an empty body", () => {
    expect(isBenignNonJsonOkResponseBody("")).toBe(true);
    expect(isBenignNonJsonOkResponseBody("   \n  ")).toBe(true);
  });

  it("returns true for HTML error pages", () => {
    expect(
      isBenignNonJsonOkResponseBody(
        "<!DOCTYPE html><html><body>403</body></html>",
      ),
    ).toBe(true);
  });

  it("returns true for Vercel edge plain-text rate limits", () => {
    expect(isBenignNonJsonOkResponseBody("Error 429: Too Many Requests")).toBe(
      true,
    );
  });

  it("returns true for Vercel deployment-not-found text", () => {
    expect(
      isBenignNonJsonOkResponseBody(
        "The deployment could not be found on Vercel.\n\nDEPLOYMENT_NOT_FOUND",
      ),
    ).toBe(true);
  });

  it("returns false for plain text that is not a known edge pattern", () => {
    expect(isBenignNonJsonOkResponseBody("not json")).toBe(false);
  });
});

describe("isBenignNonJsonOkResponseContentType", () => {
  it("returns true for text/html", () => {
    expect(
      isBenignNonJsonOkResponseContentType("text/html; charset=utf-8"),
    ).toBe(true);
  });

  it("returns false for application/json", () => {
    expect(
      isBenignNonJsonOkResponseContentType("application/json; charset=utf-8"),
    ).toBe(false);
  });
});
