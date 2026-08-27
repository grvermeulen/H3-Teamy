/** Password-reset link validity (seconds). */
export const PASSWORD_RESET_TTL_SEC = 60 * 60;

/** Normalizes token from URL/form (trim, uppercase) for Redis key lookup. */
export function normalizePasswordResetToken(raw: string): string {
  return String(raw).trim().toUpperCase();
}

export function passwordResetRedisKey(rawToken: string): string {
  return `pwreset:${normalizePasswordResetToken(rawToken)}`;
}
