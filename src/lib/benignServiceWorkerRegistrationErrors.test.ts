import { describe, expect, it } from "vitest";
import {
  isBenignServiceWorkerRegistrationError,
  isBenignServiceWorkerRegistrationMessage,
} from "./benignServiceWorkerRegistrationErrors";

describe("isBenignServiceWorkerRegistrationMessage", () => {
  it.each([
    "Script https://heren-3-de-rijn.com/sw.js load failed",
    "TypeError: Script https://heren-3-de-rijn.com/sw.js load failed",
    "Script /sw.js load failed",
    "Failed to register a ServiceWorker for scope ('https://heren-3-de-rijn.com/') with script ('https://heren-3-de-rijn.com/sw.js'): A network error occurred.",
  ])("treats %s as benign", (message) => {
    expect(isBenignServiceWorkerRegistrationMessage(message)).toBe(true);
  });

  it("does not treat unsupported MIME type as benign", () => {
    expect(
      isBenignServiceWorkerRegistrationMessage(
        "Failed to register a ServiceWorker: The script has an unsupported MIME type ('text/html').",
      ),
    ).toBe(false);
  });
});

describe("isBenignServiceWorkerRegistrationError", () => {
  it("unwraps nested causes", () => {
    const error = new Error("wrapper", {
      cause: new TypeError(
        "Script https://heren-3-de-rijn.com/sw.js load failed",
      ),
    });
    expect(isBenignServiceWorkerRegistrationError(error)).toBe(true);
  });

  it("does not treat unrelated registration blocks as benign", () => {
    expect(
      isBenignServiceWorkerRegistrationError(new Error("registration blocked")),
    ).toBe(false);
  });
});
