/**
 * Parses a comma-separated list of user IDs from an environment variable.
 *
 * @param raw - Raw env value (e.g. `ADMIN_USER_IDS`).
 * @returns Unique, trimmed user IDs.
 */
export function parseEnvUserIds(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (raw || "").split(",")) {
    const id = part.trim();
    if (id) out.add(id);
  }
  return out;
}

/**
 * Bootstrap admin user IDs from `ADMIN_USER_IDS` (comma-separated).
 * Used before the admin UI can assign roles in KV.
 */
export function getBootstrapAdminUserIds(): Set<string> {
  return parseEnvUserIds(process.env.ADMIN_USER_IDS);
}

/**
 * Bootstrap trainer user IDs from `TRAINER_USER_IDS` (comma-separated).
 * Admins from {@link getBootstrapAdminUserIds} are implicitly trainers.
 */
export function getBootstrapTrainerUserIds(): Set<string> {
  return parseEnvUserIds(process.env.TRAINER_USER_IDS);
}

/**
 * Merges KV role flags with bootstrap env user IDs for admin UI display.
 *
 * @param userId - User to resolve roles for.
 * @param kv - Role flags from Redis/KV (defaults to player-only when absent).
 * @param envAdminIds - Bootstrap admin IDs from env.
 * @param envTrainerIds - Bootstrap trainer IDs from env.
 */
export function mergeUserRoles(
  userId: string,
  kv: { admin?: boolean; trainer?: boolean; player?: boolean },
  envAdminIds: Set<string>,
  envTrainerIds: Set<string>,
): { admin: boolean; trainer: boolean; player: boolean } {
  const envAdmin = envAdminIds.has(userId);
  const envTrainer = envTrainerIds.has(userId) || envAdmin;
  return {
    player: kv.player !== false,
    trainer: Boolean(kv.trainer || envTrainer),
    admin: Boolean(kv.admin || envAdmin),
  };
}
