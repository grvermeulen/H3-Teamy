const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const base = "http://localhost:3100";
const output = path.resolve("docs/tech/arena/slice-2-verification");
fs.mkdirSync(output, { recursive: true });

function watch(page) {
  const report = {
    errors: [],
    assets: [],
    snapshots: [],
    inputs: 0,
    publications: 0,
  };
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^\/arena\/(map|sprites)\//.test(url.pathname))
      report.assets.push(url.pathname);
  });
  page.on("websocket", (socket) => {
    socket.on("framereceived", (frame) => {
      try {
        const packets = JSON.parse(frame.payload.toString());
        for (const packet of Array.isArray(packets) ? packets : [packets]) {
          for (const message of packet.messages || []) {
            if (message.name !== "state") continue;
            const data =
              typeof message.data === "string"
                ? JSON.parse(message.data)
                : message.data;
            if (data?.n === 2 && Array.isArray(data.p)) {
              report.snapshots.push(data);
              if (report.snapshots.length > 100) report.snapshots.shift();
            }
          }
        }
      } catch {
        /* Ably protocol frames without JSON data carry no game state. */
      }
    });
    socket.on("framesent", (frame) => {
      if (frame.payload.toString().includes('"name":"input"')) report.inputs++;
      if (frame.payload.toString().includes('"name":"state"'))
        report.publications++;
    });
  });
  return report;
}

async function login(context, name) {
  const { csrfToken } = await (
    await context.request.get(base + "/api/auth/csrf")
  ).json();
  await context.request.post(base + "/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email: `${name}@arena.example.test`,
      password: "arena-local-test-2026",
      json: "true",
      callbackUrl: base + "/arena/controller",
    },
  });
  const session = await (
    await context.request.get(base + "/api/auth/session")
  ).json();
  assert.ok(session.user?.email, "isolated test account signs in");
  await context.request.post(base + "/api/whats-new/ack");
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const contexts = [];
  try {
    const tv = await browser.newContext({
      viewport: { width: 1366, height: 768 },
    });
    contexts.push(tv);
    const screen = await tv.newPage();
    const screenReport = watch(screen);
    await screen.goto(base + "/arena/scherm");
    await screen.getByRole("button", { name: "Nieuwe kamer openen" }).click();
    await expect(screen.getByTestId("room-code")).toHaveText(/^[A-Z2-9]{6}$/, {
      timeout: 30000,
    });
    const code = await screen.getByTestId("room-code").innerText();
    console.log("TV room created");
    const phones = [];
    for (const [name, width, height] of [
      ["host", 390, 844],
      ["peer", 844, 390],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height },
        isMobile: true,
        hasTouch: true,
      });
      contexts.push(context);
      await login(context, name);
      const page = await context.newPage();
      const report = watch(page);
      await page.goto(base + "/arena/controller?code=" + code);
      await expect(page.getByLabel("Kamercode")).toHaveValue(code);
      await page.getByRole("button", { name: "Meedoen", exact: true }).click();
      await expect(page.getByTestId("room-code")).toHaveText(code, {
        timeout: 30000,
      });
      phones.push({ page, report });
    }
    await expect(screen.getByText("2 / 8", { exact: true })).toBeVisible({
      timeout: 20000,
    });
    const backupContext = await browser.newContext({
      viewport: { width: 1366, height: 768 },
    });
    contexts.push(backupContext);
    const backup = await backupContext.newPage();
    const backupReport = watch(backup);
    await backup.goto(base + "/arena/scherm?code=" + code);
    await backup
      .getByRole("button", { name: "Scherm verbinden", exact: true })
      .click();
    await expect(backup.getByTestId("room-code")).toHaveText(code, {
      timeout: 30000,
    });
    await expect
      .poll(() => backupReport.snapshots.length, { timeout: 15000 })
      .toBeGreaterThan(2);
    await screen.screenshot({ path: path.join(output, "tv-lobby.png") });
    await screen
      .getByRole("button", { name: "Start potje", exact: true })
      .click();
    for (const phone of phones)
      await expect(
        phone.page.getByText("Kijk naar het grote scherm"),
      ).toBeVisible({ timeout: 30000 });
    await expect(screen.getByLabel("Resterende speeltijd")).toBeVisible({
      timeout: 30000,
    });
    for (const phone of phones)
      await expect(
        phone.page.getByText("Maak je klaar", { exact: true }),
      ).toBeHidden({ timeout: 15000 });
    await expect
      .poll(() => phones[0].report.snapshots.length, { timeout: 15000 })
      .toBeGreaterThan(2);
    await phones[0].page.screenshot({
      path: path.join(output, "controller-portrait.png"),
    });
    await phones[1].page.screenshot({
      path: path.join(output, "controller-landscape.png"),
    });
    const first = phones[0].report.snapshots.at(-1);
    const surface = phones[0].page.getByTestId("touch-stick-surface");
    const box = await surface.boundingBox();
    assert.ok(box);
    await phones[0].page.mouse.move(box.x + 70, box.y + box.height / 2);
    await phones[0].page.mouse.down();
    await phones[0].page.mouse.move(box.x + 70, box.y + box.height / 2 - 50, {
      steps: 5,
    });
    await phones[0].page.waitForTimeout(1800);
    await phones[0].page.mouse.up();
    await expect
      .poll(() => phones[0].report.inputs, { timeout: 5000 })
      .toBeGreaterThan(0);
    const last = phones[0].report.snapshots.at(-1);
    assert.ok(
      last.p.some((row) => {
        const before = first.p.find((candidate) => candidate[0] === row[0]);
        return before && Math.hypot(row[1] - before[1], row[2] - before[2]) > 1;
      }),
      "controller movement reaches host snapshots",
    );
    for (const phone of phones) {
      assert.equal(
        await phone.page.locator("canvas").count(),
        0,
        "controllers have no canvas",
      );
      assert.deepEqual(
        phone.report.assets,
        [],
        "controllers load no map or sprites",
      );
      assert.deepEqual(
        phone.report.errors,
        [],
        "controller has no browser errors",
      );
    }
    await screen.screenshot({ path: path.join(output, "tv-playing.png") });
    const colours = await screen
      .getByLabel("GTA H3 gezamenlijk speelveld")
      .evaluate((canvas) => {
        const ctx = canvas.getContext("2d");
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const colours = new Set();
        for (let i = 0; i < pixels.length; i += 400)
          colours.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        return colours.size;
      });
    assert.ok(colours > 50, "TV canvas contains the rendered city");
    assert.deepEqual(screenReport.errors, [], "TV has no browser errors");
    await screen
      .getByRole("button", { name: "Scherm sluiten", exact: true })
      .click();
    await expect
      .poll(() => backupReport.publications, { timeout: 25000 })
      .toBeGreaterThan(2);
    await expect(backup.getByLabel("Resterende speeltijd")).toBeVisible({
      timeout: 15000,
    });
    const takeoverTick = phones[0].report.snapshots.at(-1).t;
    await expect
      .poll(() => phones[0].report.snapshots.at(-1).t, { timeout: 15000 })
      .toBeGreaterThan(takeoverTick + 3);
    assert.deepEqual(
      phones[0].report.snapshots.at(-1).p.map((row) => row[0]),
      last.p.map((row) => row[0]),
      "host takeover preserves player seats",
    );
    assert.deepEqual(backupReport.errors, [], "new host has no browser errors");
    await backup.screenshot({ path: path.join(output, "tv-takeover.png") });
    fs.writeFileSync(
      path.join(output, "browser.json"),
      JSON.stringify(
        {
          passed: true,
          code,
          controllerMapRequests: phones.map(
            (phone) => phone.report.assets.length,
          ),
          controllerSnapshots: phones.map(
            (phone) => phone.report.snapshots.length,
          ),
          movementObserved: true,
          renderedColours: colours,
          hostTakeover: true,
          browserErrors: screenReport.errors.concat(
            backupReport.errors,
            ...phones.map((phone) => phone.report.errors),
          ),
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: TV + two authenticated phones, city rendering, movement, second-screen takeover, no phone map assets, no browser errors",
    );
    for (const phone of phones)
      await phone.page
        .getByRole("button", { name: "Verlaten", exact: true })
        .click();
    await backup
      .getByRole("button", { name: "Scherm sluiten", exact: true })
      .click();
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
