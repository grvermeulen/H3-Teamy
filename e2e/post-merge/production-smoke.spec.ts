import { expect, test } from "@playwright/test";

/**
 * Niet-destructieve deploy-smoke: alleen GET-navigatie, geen registratie/login-submit,
 * geen datawijziging. Draait tegen preview (CI) of productie (post-merge secret).
 */
test.describe("Read-only deploy smoke", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(({}, testInfo) => {
    test.skip(
      !process.env.PRODUCTION_VERIFY_BASE_URL,
      "Stel PRODUCTION_VERIFY_BASE_URL in (deploy-origin) om deze tests lokaal te draaien.",
    );
    testInfo.annotations.push({
      type: "non-destructive",
      description: "GET-only; geen schrijfacties op productie",
    });
  });

  test("app-shell toont teamtitel in header", async ({ page }) => {
    // `/` doet zware Sportlink/iCal-SSR; statische pagina dekt dezelfde layout/header-smoke.
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    // Site title lives in the global header (not necessarily as <h1> — subpages have their own h1).
    await expect(
      page
        .locator("header")
        .getByText("De Rijn H3 — Waterpolo", { exact: true }),
    ).toBeVisible();
  });

  test("loginpagina laadt", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: "Inloggen" }),
    ).toBeVisible();
  });
});
