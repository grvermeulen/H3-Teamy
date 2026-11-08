/**
 * Layout-verificatie op smalle viewports.
 *
 * Gebruik:
 *   VERIFY_URL=http://127.0.0.1:3000/mobile-layout-fixture \
 *   VERIFY_ARTIFACT_TAG=fixed-branch \
 *   node scripts/verify-mobile-layout.mjs
 *
 * Voor baseline (onveranderde site):
 *   VERIFY_URL=https://heren-3-de-rijn.com VERIFY_ARTIFACT_TAG=prod-baseline \
 *   VERIFY_EXPECT_PASS=0 node scripts/verify-mobile-layout.mjs
 */
import { chromium, devices } from "playwright";
import { mkdir } from "node:fs/promises";

const url =
  process.env.VERIFY_URL ?? "http://127.0.0.1:3000/mobile-layout-fixture";
const artifactTag = process.env.VERIFY_ARTIFACT_TAG ?? "run";
const expectPass =
  process.env.VERIFY_EXPECT_PASS !== "0" &&
  process.env.VERIFY_EXPECT_PASS !== "false";
const widths = [320, 375, 390, 430];
const outDir = "/opt/cursor/artifacts";
await mkdir(outDir, { recursive: true });

const isFixture = url.includes("mobile-layout-fixture");

async function mockSession(page) {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { email: "trainer@example.test", name: "Trainer" },
      }),
    });
  });
  await page.route("**/api/admin/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ isAdmin: true }),
    });
  });
  await page.route("**/api/trainer/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ isTrainer: true }),
    });
  });
  await page.route("**/api/rsvp/list**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        counts: { yes: 10, maybe: 5, no: 4 },
        lists: { yes: [], maybe: [], no: [] },
      }),
    });
  });
  await page.route("**/api/rsvp", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: null }),
      });
      return;
    }
    await route.fulfill({ status: 200, body: "{}" });
  });
}

function fitsViewport(box, viewportWidth, tolerance = 2) {
  if (!box) return false;
  return box.right <= viewportWidth + tolerance && box.left >= -tolerance;
}

const browser = await chromium.launch();
const results = [];
let layoutAssertions = [];

for (const width of widths) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  if (isFixture) {
    await mockSession(page);
  }
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  if (isFixture) {
    await page.waitForSelector(".event-list-refresh, .event-rsvp-toggle, .card", {
      timeout: 60_000,
    });
  } else {
    await page.waitForTimeout(1500);
  }

  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return {
      docScrollWidth: doc.scrollWidth,
      bodyScrollWidth: body.scrollWidth,
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      clientWidth: doc.clientWidth,
    };
  });
  const overflow = metrics.scrollWidth - metrics.clientWidth;

  let elementChecks = null;
  if (isFixture) {
    const pfcCard = page
      .locator(".card")
      .filter({ hasText: "PFC Rheden H2-De Rijn H3" })
      .first();
    await pfcCard.waitFor({ state: "visible", timeout: 15_000 });

    const boxes = await pfcCard.evaluate((card, vw) => {
      const nee = card.querySelector(".event-rsvp-toggle button:last-child");
      const fileInput = card.querySelector('.event-report-row input[type="file"]');
      const reportBtn = card.querySelector(".event-report-row button");
      const description = card.querySelector(".event-description");
      const toRects = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      };
      return {
        nee: toRects(nee),
        fileInput: toRects(fileInput),
        reportBtn: toRects(reportBtn),
        description: toRects(description),
        viewportWidth: vw,
      };
    }, width);

    const rowErrors = [];
    const okOverflow = overflow <= 1;
    const okNee = fitsViewport(boxes.nee, width);
    const okFile = fitsViewport(boxes.fileInput, width);
    const okReport = fitsViewport(boxes.reportBtn, width);
    const okDesc =
      !boxes.description || boxes.description.right <= width + 2;

    if (!okOverflow) rowErrors.push("document_overflow");
    if (!okNee) rowErrors.push("rsvp_nee_clipped");
    if (!okFile) rowErrors.push("file_input_clipped");
    if (!okReport) rowErrors.push("report_button_clipped");
    if (!okDesc) rowErrors.push("source_url_clipped");

    elementChecks = {
      nee: boxes.nee,
      fileInput: boxes.fileInput,
      reportBtn: boxes.reportBtn,
      description: boxes.description,
      okNee,
      okFile,
      okReport,
      okDesc,
      rowErrors,
      rowOk: rowErrors.length === 0,
    };
    layoutAssertions.push({ width, ...elementChecks, overflow, okOverflow });
  }

  results.push({ width, ...metrics, overflow, elementChecks });

  const shotName = `mobile-layout-${artifactTag}-${width}px.png`;
  await page.screenshot({
    path: `${outDir}/${shotName}`,
    fullPage: true,
  });
  await context.close();
}

await browser.close();

for (const row of results) {
  console.log(
    JSON.stringify({
      tag: artifactTag,
      url,
      width: row.width,
      scrollWidth: row.scrollWidth,
      clientWidth: row.clientWidth,
      bodyScrollWidth: row.bodyScrollWidth,
      docScrollWidth: row.docScrollWidth,
      overflow: row.overflow,
      documentOk: row.overflow <= 1,
      elements: row.elementChecks,
    }),
  );
}

const docFailed = results.filter((r) => r.overflow > 1);
const elementFailed = layoutAssertions.filter((r) => !r.rowOk);

let exitOk = docFailed.length === 0;
if (isFixture) {
  exitOk = exitOk && elementFailed.length === 0;
}

if (expectPass) {
  process.exitCode = exitOk ? 0 : 1;
} else {
  process.exitCode = exitOk ? 1 : 0;
  console.log(
    JSON.stringify({
      baselineMode: true,
      note: "VERIFY_EXPECT_PASS=0: success = detected overflow/issues",
      detectedIssues: !exitOk,
    }),
  );
}
