/** Sensitive path pattern with a short Dutch/English label for reports. */
export interface SensitivePathRule {
  pattern: RegExp;
  label: string;
}

/** Paths that warrant extra scrutiny in H3-Teamy PR risk assessment. */
export const SENSITIVE_PATH_RULES: SensitivePathRule[] = [
  { pattern: /^src\/app\/api\/auth\//, label: "auth API" },
  { pattern: /^src\/lib\/services\/passkeyService\.ts$/, label: "passkeys/WebAuthn" },
  { pattern: /^src\/lib\/webAuthn/, label: "WebAuthn config" },
  { pattern: /^src\/lib\/passwordReset/, label: "password reset" },
  { pattern: /^src\/lib\/authOptions\.ts$/, label: "NextAuth options" },
  { pattern: /^prisma\/schema\.prisma$/, label: "Prisma schema" },
  { pattern: /^prisma\/migrations\//, label: "DB migrations" },
  { pattern: /^src\/lib\/services\//, label: "service layer" },
  { pattern: /^src\/app\/api\//, label: "API routes" },
  { pattern: /^ocr-worker\//, label: "OCR worker" },
  { pattern: /^\.github\/workflows\//, label: "CI workflows" },
  { pattern: /^package(-lock)?\.json$/, label: "dependencies" },
  { pattern: /^src\/lib\/rateLimit\.ts$/, label: "rate limiting" },
  { pattern: /^src\/lib\/arenaAuth\.ts$/, label: "arena auth" },
  { pattern: /^src\/middleware/, label: "middleware" },
];

/** Repo context blurb included in JEV state (English for model quality). */
export const REPO_CONTEXT = [
  "H3-Teamy is a Next.js 16 team-management app (Dutch UI) with NextAuth, WebAuthn passkeys,",
  "password reset via Resend, Prisma/PostgreSQL, Redis cache, Sportlink iCal, arena multiplayer game,",
  "and an OCR worker. Business logic lives in src/lib/services; API routes should stay thin.",
  "Sensitive areas: auth/passkeys, password reset, Prisma schema/migrations, API routes, CI workflows, deps.",
].join(" ");

/**
 * Returns human-readable labels for changed paths that match sensitive rules.
 * @param paths - Changed file paths in the PR.
 */
export function matchSensitivePaths(paths: string[]): string[] {
  const matched = new Set<string>();
  for (const path of paths) {
    for (const rule of SENSITIVE_PATH_RULES) {
      if (rule.pattern.test(path)) {
        matched.add(rule.label);
      }
    }
  }
  return [...matched].sort();
}
