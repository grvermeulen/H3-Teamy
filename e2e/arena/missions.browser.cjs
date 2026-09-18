const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const anchors = require("../../src/lib/cityArena/missions/anchors.generated.json");
const base = "http://localhost:3100";
const output = path.resolve(".cache/arena-mission-verification");
const point = (id) => anchors.anchors.find((entry) => entry.id === id).position;

async function login(context) {
  const { csrfToken } = await (
    await context.request.get(base + "/api/auth/csrf")
  ).json();
  await context.request.post(base + "/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email: "host@arena.example.test",
      password: "arena-local-test-2026",
      json: "true",
      callbackUrl: base,
    },
  });
  await context.request.post(base + "/api/whats-new/ack");
}

async function visit(page, position, holdMs = 120) {
  await page.evaluate((at) => {
    const player = window.__arena.getState().players[0];
    player.x = at[0];
    player.y = at[1];
    player.speed = 0;
    player.vehicleId = null;
    window.__arena.dispatch({ enter: false }, 2);
  }, position);
  await page.waitForTimeout(150);
  if (holdMs === 0) return;
  await page.keyboard.down("e");
  await page.waitForTimeout(holdMs);
  await page.keyboard.up("e");
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
    });
    await login(context);
    await context.addInitScript(() => {
      localStorage.setItem("h3-arena-touch-tip-v1", "1");
      localStorage.removeItem("h3-arena-story-v1");
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/?debug=1");
    await page
      .getByRole("button", { name: "Soloverhaal · missies en vrij rondrijden" })
      .click();
    await expect
      .poll(() => page.evaluate(() => !!window.__arena?.getState()))
      .toBe(true);
    await visit(page, point("noor"));
    const offer = page.getByRole("dialog", { name: "Verkeerd bezorgd" });
    await expect(offer).toBeVisible();
    await page.screenshot({ path: path.join(output, "desktop-briefing.png") });
    await offer.getByRole("button", { name: "Aannemen" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__arena.getState().players[0].mission?.run?.stage,
        ),
      )
      .toBe(0);
    await expect(offer).not.toBeVisible();
    await page.addStyleTag({
      content:
        '[class*="font-mono"][class*="pointer-events-none"]{visibility:hidden}',
    });
    // The actual objective sequence is read from the UI; destinations are developer test warps.
    fs.writeFileSync(
      path.join(output, "initial-state.json"),
      JSON.stringify(
        await page.evaluate(() => window.__arena.getState().players[0].mission),
        null,
        2,
      ),
    );
    await page.screenshot({ path: path.join(output, "desktop-mission.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, "mobile-mission.png") });
    await visit(page, point("M01:parcel"));
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__arena.getState().players[0].mission.run.stage,
        ),
      )
      .toBe(1);
    await visit(page, point("M01:note"), 1400);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__arena.getState().players[0].mission.run.stage,
        ),
      )
      .toBe(2);
    await visit(page, point("M01:old-door"), 0);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__arena.getState().players[0].mission.run.stage,
        ),
      )
      .toBe(3);
    const neighbour = await page.evaluate(() => {
      const state = window.__arena.getState();
      const id = state.players[0].mission.actors.neighbour.id;
      const ped = state.peds.find((p) => p.id === id);
      return [ped.x, ped.y];
    });
    await visit(page, neighbour);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__arena.getState().players[0].mission.run.stage,
        ),
      )
      .toBe(4);
    await visit(page, point("M01:recipient"));
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__arena.getState().players[0].mission.wallet.earned,
        ),
      )
      .toBe(325);
    await page.waitForTimeout(1100);
    await page.getByRole("button", { name: "Sluiten", exact: true }).click();
    await page
      .getByRole("button", { name: "Soloverhaal · missies en vrij rondrijden" })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__arena?.getState()?.players[0].mission?.wallet.earned,
        ),
      )
      .toBe(325);
    await page.screenshot({
      path: path.join(output, "mobile-payout-restored.png"),
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    if (overflow) throw new Error("Mission UI overflows the mobile viewport");
    if (errors.length) throw new Error(errors.join("\n"));
    fs.writeFileSync(
      path.join(output, "browser-result.json"),
      JSON.stringify(
        {
          briefing: true,
          accept: true,
          completed: "M01",
          paid: 325,
          restored: 325,
          mobileOverflow: false,
          errors,
        },
        null,
        2,
      ),
    );
    console.log("Mission briefing, acceptance and mobile layout passed");
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
