import { describe, expect, it } from "vitest";
import { matchSensitivePaths } from "./sensitivePaths";

describe("matchSensitivePaths", () => {
  it("labels auth and prisma paths", () => {
    const labels = matchSensitivePaths([
      "src/app/api/auth/passkey/register/route.ts",
      "prisma/migrations/20260101_init/migration.sql",
    ]);
    expect(labels).toContain("auth API");
    expect(labels).toContain("DB migrations");
  });
});
