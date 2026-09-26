import { describe, expect, it } from "vitest";
import type { Event, EventHint } from "@sentry/nextjs";
import {
  BENIGN_POINTER_LOCK_WRONG_DOCUMENT_IGNORE_RE,
  shouldDropBenignPointerLockNoiseEvent,
} from "./sentryBenignPointerLockNoise";

const baseEvent = {} as Event;
const pointerLockMessage =
  "WrongDocumentError: The root document of this element is not valid for pointer lock.";

describe("BENIGN_POINTER_LOCK_WRONG_DOCUMENT_IGNORE_RE", () => {
  it("matches the production Sentry error message", () => {
    expect(
      BENIGN_POINTER_LOCK_WRONG_DOCUMENT_IGNORE_RE.test(pointerLockMessage),
    ).toBe(true);
  });
});

describe("shouldDropBenignPointerLockNoiseEvent", () => {
  it("returns true for WrongDocumentError pointer lock rejections", () => {
    const hint: EventHint = {
      originalException: new DOMException(
        "The root document of this element is not valid for pointer lock.",
        "WrongDocumentError",
      ),
    };
    expect(shouldDropBenignPointerLockNoiseEvent(baseEvent, hint)).toBe(true);
  });

  it("returns true when only the Sentry event exception value is set", () => {
    const event = {
      exception: { values: [{ value: pointerLockMessage }] },
    } as Event;
    expect(shouldDropBenignPointerLockNoiseEvent(event, {})).toBe(true);
  });

  it("returns true when only event.message is set", () => {
    const event = { message: pointerLockMessage } as Event;
    expect(shouldDropBenignPointerLockNoiseEvent(event, {})).toBe(true);
  });

  it("returns false for real application errors", () => {
    const hint: EventHint = {
      originalException: new Error("Arena boot failed"),
    };
    expect(shouldDropBenignPointerLockNoiseEvent(baseEvent, hint)).toBe(false);
  });
});
