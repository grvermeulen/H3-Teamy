import { describe, expect, it } from "vitest";
import { arenaCastDevice } from "./castHelp";

describe("arena cast instructions", () => {
  it.each([
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      "iPhone",
      5,
      "iphone",
    ],
    ["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", "iPad", 5, "iphone"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 5, "iphone"],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      "MacIntel",
      0,
      "computer",
    ],
    [
      "Mozilla/5.0 (Linux; Android 15) Chrome/140",
      "Linux armv8l",
      5,
      "android",
    ],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32", 10, "computer"],
  ])(
    "selects the instructions for %s",
    (userAgent, platform, maxTouchPoints, expected) => {
      expect(arenaCastDevice({ userAgent, platform, maxTouchPoints })).toBe(
        expected,
      );
    },
  );
});
