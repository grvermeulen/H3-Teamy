import { describe, expect, it } from "vitest";
import { isBenignWebAuthnClientError } from "./webAuthnClientErrors";

describe("isBenignWebAuthnClientError", () => {
  it("returns true for NotAllowedError", () => {
    const err = new DOMException(
      "not allowed",
      "NotAllowedError",
    );
    expect(isBenignWebAuthnClientError(err)).toBe(true);
  });

  it("returns true for AbortError", () => {
    const err = new DOMException("aborted", "AbortError");
    expect(isBenignWebAuthnClientError(err)).toBe(true);
  });

  it("returns false for other DOMExceptions", () => {
    const err = new DOMException("invalid state", "InvalidStateError");
    expect(isBenignWebAuthnClientError(err)).toBe(false);
  });

  it("returns false for plain Error", () => {
    expect(isBenignWebAuthnClientError(new Error("network"))).toBe(false);
  });

  it("returns true when benign DOMException is nested as cause", () => {
    const inner = new DOMException(
      "timed out",
      "NotAllowedError",
    );
    const wrapped = new Error("wrap");
    wrapped.cause = inner;
    expect(isBenignWebAuthnClientError(wrapped)).toBe(true);
  });
});
