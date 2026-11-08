/**
 * Meet horizontale overflow op smalle viewports (read-only GET).
 * Gebruik: HOME_OVERFLOW_URL=https://heren-3-de-rijn.com node scripts/check-home-mobile-overflow.mjs
 */
import { chromium, devices } from "playwright";

const url = process.env.HOME_OVERFLOW_URL ?? "http://127.0.0.1:3000";
const widths = [320, 375, 390, 430];

const browser = await chromium.launch();
const results = [];

for (const width of widths) {
  const context = await browser.newContext({
    ...devices["iPhone 12"],
    viewport: { width, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const clientWidth = doc.clientWidth;
    return {
      scrollWidth,
      clientWidth,
      bodyScrollWidth: body.scrollWidth,
      docScrollWidth: doc.scrollWidth,
    };
  });
  const overflow = metrics.scrollWidth - metrics.clientWidth;
  results.push({ width, ...metrics, overflow });
  await page.screenshot({
    path: `/opt/cursor/artifacts/home-mobile-${width}-after.png`,
    fullPage: true,
  });
  await context.close();
}

await browser.close();

for (const row of results) {
  const ok = row.overflow <= 1;
  console.log(
    JSON.stringify({ ...row, ok, url }),
  );
}

const failed = results.filter((r) => r.overflow > 1);
process.exitCode = failed.length ? 1 : 0;
