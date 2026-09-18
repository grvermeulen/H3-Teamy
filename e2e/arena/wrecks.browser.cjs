const { chromium } = require("@playwright/test");
const { build } = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const output = path.resolve(".cache/arena-wrecks");
  fs.mkdirSync(output, { recursive: true });
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { createSpriteStore } from './src/lib/cityArena/render/loadSprites';
        import { createDomCanvasFactory } from './src/lib/cityArena/render/canvasTypes';
        import { drawVehicle } from './src/lib/cityArena/render/drawVehicles';
        import { vehicleWreckSpriteFor } from './src/lib/cityArena/render/sprites';
        import { VEHICLE_KINDS, VEHICLE_SPECS, createVehicle } from './src/lib/cityArena/sim/vehicle';
        import { applyExplosions } from './src/lib/cityArena/sim/combat';
        const store = createSpriteStore({ canvasFactory: createDomCanvasFactory() });
        window.previewWrecks = async (zoom) => {
          await store.load();
          const art = store.current();
          const canvas = document.querySelector('canvas');
          canvas.width = 1200; canvas.height = 560;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = ctx.createPattern(art.ground.urban.image, 'repeat');
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          for (const [index, kind] of VEHICLE_KINDS.entries()) {
            if (!vehicleWreckSpriteFor(art, kind)) throw new Error('Missing wreck art: ' + kind);
            const x = (index % 5) * 240;
            const y = Math.floor(index / 5) * 280;
            ctx.fillStyle = '#f1eee6'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(VEHICLE_SPECS[kind].label, x + 120, y + 30);
            ctx.font = '12px sans-serif';
            ctx.fillText('Intact', x + 68, y + 55); ctx.fillText('Wrak', x + 172, y + 55);
            const car = createVehicle(index + 1, kind, [0, 0], -Math.PI / 2, 3);
            const exploded = applyExplosions({ vehicles: [{ ...car, health: 0 }], players: [], peds: [], cops: [], events: [], effects: [], nextId: 100 }, {}, 60);
            const wreck = exploded.vehicles[0];
            if (!wreck.wrecked || !exploded.events.some(event => event.kind === 'explosion')) throw new Error('Missing explosion for ' + kind);
            for (const [column, vehicle] of [car, wreck].entries()) {
              ctx.save(); ctx.translate(x + (column ? 172 : 68), y + 162);
              drawVehicle(ctx, { x: 0, y: 0, zoom }, { width: 0, height: 0 }, vehicle, 60, false, art, true);
              ctx.restore();
            }
          }
          return VEHICLE_KINDS.length;
        };
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    alias: { "@sentry/nextjs": "@sentry/browser" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({
      viewport: { width: 1220, height: 580 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://arena.test/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: "<canvas></canvas>",
        });
      const filename = path.basename(pathname);
      return route.fulfill({
        path: path.resolve("public/arena/sprites", filename),
      });
    });
    await page.goto("http://arena.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    for (const zoom of [8, 14]) {
      const count = await page.evaluate(
        (scale) => window.previewWrecks(scale),
        zoom,
      );
      if (count !== 10)
        throw new Error(`Expected 10 vehicle kinds, got ${count}`);
      await page
        .locator("canvas")
        .screenshot({ path: path.join(output, `wrecks-${zoom}.png`) });
    }
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "All 10 vehicle kinds transition from intact to loaded wreck artwork at both zoom levels",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
