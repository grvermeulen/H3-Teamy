/**
 * Default bootstrap role user IDs for De Rijn H3 Teamy production.
 *
 * Sourced from production `Attendance.markedBy` (users who registered training
 * attendance) plus the project owner as admin. Override via `ADMIN_USER_IDS` /
 * `TRAINER_USER_IDS` when needed (e.g. preview DB with different IDs).
 *
 * The Prisma seed login (`trainer@example.test`) is also always trainer+admin:
 * its CUID differs per database, so env ID lists never match it.
 */
export const PREVIEW_SEED_TRAINER_EMAIL = "trainer@example.test";

/**
 * Whether `email` is the documented preview seed trainer (case-insensitive).
 */
export function isPreviewSeedTrainerEmail(
  email: string | null | undefined,
): boolean {
  return email?.trim().toLowerCase() === PREVIEW_SEED_TRAINER_EMAIL;
}

export const BOOTSTRAP_ADMIN_USER_IDS = [
  "7651890a-f601-4711-9ff0-64da8ac052dc", // Guido Vermeulen
] as const;

export const BOOTSTRAP_TRAINER_USER_IDS = [
  "cmexxuyh60001fvfvr4s97ee6", // Andre Staal
  "cmjhqic0t0001dvv4zuy3pfae", // Henry Turkenburg
  "cmesohfy00003peijgslbdi13", // Jan Willem Pater
  "cmexwduu60001rngcifi58jtx", // Frank Volkering
  "90a6f54a-8add-407a-b7f2-a9cfc87b75d7", // Harry Stens
] as const;
