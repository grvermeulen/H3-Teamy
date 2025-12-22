import { z } from "zod";

export const PasswordResetRequestBodySchema = z.object({
  email: z.string().email(),
});

export const PasswordResetRequestResponseSchema = z.object({
  ok: z.boolean(),
});

export const PasswordResetConfirmBodySchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

export const PasswordResetConfirmResponseSchema = z
  .object({
    ok: z.boolean(),
  })
  .or(z.object({ error: z.string() }));

export type PasswordResetRequestBody = z.infer<
  typeof PasswordResetRequestBodySchema
>;
export type PasswordResetConfirmBody = z.infer<
  typeof PasswordResetConfirmBodySchema
>;
