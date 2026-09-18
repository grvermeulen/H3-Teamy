const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const base = "http://localhost:3100";
const output = path.resolve(".cache/arena-mission-verification/multiplayer");

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
      callbackUrl: base + "/arena/spelen",
    },
  });
  assert.ok(
    (await (await context.request.get(base + "/api/auth/session")).json()).user
      ?.email,
  );
  await context.request.post(base + "/api/whats-new/ack");
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
    await login(context, "host");
    await context.addInitScript(() => {
      localStorage.setItem("h3-arena-touch-tip-v1", "1");
      window.__testPad = {
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({
          pressed: false,
          value: 0,
          touched: false,
        })),
        connected: true,
        mapping: "standard",
      };
      Object.defineProperty(navigator, "getGamepads", {
        value: () => [window.__testPad],
      });
      window.__arenaLabels = new Set();
      const drawText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (...args) {
        if (String(args[0]).includes("Audit"))
          window.__arenaLabels.add(args[0]);
        return drawText.apply(this, args);
      };
    });
    const page = await context.newPage();
    const errors = [];
    let memberId;
    let role;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", async (response) => {
      if (
        new URL(response.url()).pathname === "/api/arena/session" &&
        response.ok()
      ) {
        const ticket = (await response.json()).ticket;
        if (ticket) {
          memberId = ticket.memberId;
          role = ticket.members.find(
            (member) => member.clientId === memberId,
          )?.role;
        }
      }
    });
    await page.goto(base + "/arena/spelen");
    await expect(
      page.getByRole("button", { name: /Potje openen in/ }),
    ).toBeEnabled();
    await page.getByLabel("Speelstand").selectOption("hybrid");
    await page.getByRole("button", { name: /Potje openen in/ }).click();
    await expect(page.getByTestId("room-code")).toHaveText(/^[A-Z2-9]{6}$/, {
      timeout: 45000,
    });
    const code = await page.getByTestId("room-code").innerText();
    assert.equal(role, "hybrid", "selected mode reaches the room service");
    const phoneContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await login(phoneContext, "peer");
    const phone = await phoneContext.newPage();
    let latest;
    phone.on("pageerror", (error) => errors.push(error.message));
    phone.on("websocket", (socket) =>
      socket.on("framereceived", (frame) => {
        try {
          const parsed = JSON.parse(frame.payload.toString());
          for (const packet of Array.isArray(parsed) ? parsed : [parsed])
            for (const message of packet.messages || []) {
              if (message.name === "state") {
                const state =
                  typeof message.data === "string"
                    ? JSON.parse(message.data)
                    : message.data;
                if (state?.n === 3) latest = state;
              }
            }
        } catch {
          /* Non-state Ably frames carry no simulation data. */
        }
      }),
    );
    await phone.goto(base + "/arena/controller?code=" + code);
    await phone.getByRole("button", { name: "Meedoen", exact: true }).click();
    await expect(page.getByText("2 / 8", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await page
      .getByRole("button", { name: "Start potje", exact: true })
      .click();
    await expect(page.getByLabel("Resterende speeltijd")).toBeVisible({
      timeout: 30000,
    });
    await expect(phone.getByLabel("Resterende speeltijd")).toBeVisible({
      timeout: 15000,
    });
    await expect.poll(() => latest?.p.length, { timeout: 15000 }).toBe(2);
    const seat = latest.m.find(([clientId]) => clientId === memberId)?.[1];
    assert.ok(seat !== undefined);
    const position = () => latest.p.find((row) => row[0] === seat).slice(1, 3);
    const before = position();
    await page.evaluate(() => {
      window.__testPad.axes = [1, 0, 0, 0];
    });
    await expect
      .poll(
        () => Math.hypot(position()[0] - before[0], position()[1] - before[1]),
        { timeout: 5000 },
      )
      .toBeGreaterThan(1);
    await page.evaluate(() => {
      window.__testPad.connected = false;
      window.dispatchEvent(new Event("gamepaddisconnected"));
    });
    await page.waitForTimeout(500);
    const stopped = position();
    await page.waitForTimeout(600);
    assert.ok(
      Math.hypot(position()[0] - stopped[0], position()[1] - stopped[1]) < 1,
      "disconnected gamepad releases movement",
    );
    const colourCount = await page
      .getByLabel("GTA H3 speelveld", { exact: true })
      .evaluate((canvas) => {
        const pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        const colours = new Set();
        for (let i = 0; i < pixels.length; i += 200)
          colours.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        return colours.size;
      });
    assert.ok(colourCount > 50);
    assert.deepEqual(errors, []);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            [...window.__arenaLabels].some((text) =>
              text.includes("Audit Host"),
            ) &&
            [...window.__arenaLabels].some((text) =>
              text.includes("Audit Speler"),
            ),
        ),
      )
      .toBe(true);
    await expect(page.getByTestId("touch-stick-surface")).toBeVisible();
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "hybrid-landscape.png") });
    fs.writeFileSync(
      path.join(output, "hybrid.json"),
      JSON.stringify(
        {
          passed: true,
          players: latest.p.length,
          simulatedGamepadMovement: true,
          disconnectStopsMovement: true,
          renderedColours: colourCount,
          browserErrors: errors,
        },
        null,
        2,
      ),
    );
    await phone.getByRole("button", { name: "Verlaten", exact: true }).click();
    await page.getByRole("button", { name: "Sluiten", exact: true }).click();
    console.log(
      "PASS: mirrored hybrid + controller, shared canvas, simulated gamepad movement and disconnect",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
