import { describe, expect, it } from "vitest";
import {
  normalizePasswordResetToken,
  passwordResetPendingKey,
  passwordResetRedisKey,
} from "./passwordResetToken";

describe("passwordResetToken", () => {
  it("normalizes trim and case", () => {
    expect(normalizePasswordResetToken("  abcd12xy  ")).toBe("ABCD12XY");
  });

  it("builds pending key per user", () => {
    expect(passwordResetPendingKey("user_abc")).toBe("pwreset:pending:user_abc");
  });
});
