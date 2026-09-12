import { describe, expect, it } from "vitest";
import {
  PasswordResetConfirmBodySchema,
  PasswordResetConfirmResponseSchema,
  PasswordResetRequestBodySchema,
  PasswordResetRequestResponseSchema,
} from "./auth";

describe("auth schemas", () => {
  it("PasswordResetRequestBodySchema accepteert geldig e-mail", () => {
    expect(PasswordResetRequestBodySchema.parse({ email: "a@b.co" })).toEqual({
      email: "a@b.co",
    });
  });

  it("PasswordResetRequestBodySchema wijst ongeldig e-mail af", () => {
    expect(() =>
      PasswordResetRequestBodySchema.parse({ email: "geen-mail" }),
    ).toThrow();
  });

  it("PasswordResetRequestResponseSchema", () => {
    expect(PasswordResetRequestResponseSchema.parse({ ok: true })).toEqual({
      ok: true,
    });
    expect(
      PasswordResetRequestResponseSchema.parse({
        ok: true,
        sent: true,
        suppressed: false,
      }),
    ).toEqual({ ok: true, sent: true, suppressed: false });
  });

  it("PasswordResetConfirmBodySchema", () => {
    expect(
      PasswordResetConfirmBodySchema.parse({
        token: "t",
        newPassword: "12345678",
      }),
    ).toEqual({ token: "t", newPassword: "12345678" });
  });

  it("PasswordResetConfirmResponseSchema union", () => {
    expect(PasswordResetConfirmResponseSchema.parse({ ok: true })).toEqual({
      ok: true,
    });
    expect(PasswordResetConfirmResponseSchema.parse({ error: "x" })).toEqual({
      error: "x",
    });
  });
});
