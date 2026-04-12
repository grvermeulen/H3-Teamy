import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright-configuratie voor read-only smoke (GET’s) tegen een gedeployde omgeving.
 * CI: preview via `preview-e2e-verify.yml` (URL uit deployment); main via `post-merge-verify.yml`
 * en secret `PRODUCTION_VERIFY_BASE_URL`.
 */
const baseURL =
  process.env.PRODUCTION_VERIFY_BASE_URL?.replace(/\/+$/, "") ?? "";

if (process.env.CI === "true" && !baseURL) {
  throw new Error(
    "PRODUCTION_VERIFY_BASE_URL ontbreekt in CI: zet het voor post-merge (secret), of gebruik preview-workflow die de URL zet.",
  );
}

export default defineConfig({
  testDir: "./e2e/post-merge",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["list"],
  ],
  use: {
    baseURL: baseURL || undefined,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
