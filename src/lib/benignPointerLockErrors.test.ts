import { describe, expect, it } from "vitest";
import { isBenignPointerLockClientError } from "./benignPointerLockErrors";

const pointerLockMessage =
  "The root document of this element is not valid for pointer lock.";

describe("isBenignPointerLockClientError", () => {
  it("returns true for WrongDocumentError pointer lock rejections", () => {
    expect(
      isBenignPointerLockClientError(
        new DOMException(pointerLockMessage, "WrongDocumentError"),
      ),
    ).toBe(true);
  });

  it("returns true when the message is nested as cause", () => {
    const inner = new DOMException(pointerLockMessage, "WrongDocumentError");
    expect(
      isBenignPointerLockClientError(
        new Error("Unhandled rejection", { cause: inner }),
      ),
    ).toBe(true);
  });

  it("returns true for plain rejection strings", () => {
    expect(
      isBenignPointerLockClientError(
        `WrongDocumentError: ${pointerLockMessage}`,
      ),
    ).toBe(true);
  });

  it("returns false for other WrongDocumentError messages", () => {
    expect(
      isBenignPointerLockClientError(
        new DOMException("Node is not connected.", "WrongDocumentError"),
      ),
    ).toBe(false);
  });

  it("returns false for real application errors", () => {
    expect(isBenignPointerLockClientError(new Error("Arena boot failed"))).toBe(
      false,
    );
  });
});
