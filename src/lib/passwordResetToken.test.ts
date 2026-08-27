import { describe, expect, it } from "vitest";
import {
  normalizePasswordResetToken,
  passwordResetRedisKey,
} from "./passwordResetToken";

describe("passwordResetToken", () => {
  it("normalizes trim and case", () => {
    expect(normalizePasswordResetToken("  abcd12xy  ")).toBe("ABCD12XY");
  });

  it("builds redis key with normalized token", () => {
    expect(passwordResetRedisKey("abc123xy")).toBe("pwreset:ABC123XY");
  });
});
