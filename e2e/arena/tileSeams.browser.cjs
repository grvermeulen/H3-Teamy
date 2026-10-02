const { chromium } = require("@playwright/test");
const { build } = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const output = path.resolve(".cache/arena-tile-seams");
  fs.mkdirSync(output, { recursive: true });
  const bundle = await build({
    stdin: {
      contents: `
        import { createStaticRaster } from './src/lib/cityArena/render/staticRaster';
        import { createDomCanvasFactory } from './src/lib/cityArena/render/canvasTypes';
        import { drawVisibleChunks } from './src/lib/cityArena/render/drawWorld';
        import { decodeTile } from './src/lib/cityArena/world/decode';
        window.previewMap = async (index, rawTile, surfaces) => {
          const textures = Object.fromEntries(await Promise.all(Object.entries(surfaces).map(async ([name, entry]) => {
            const image = new Image();
            image.src = entry.data;
            await image.decode();
            return [name, { ...entry, image }];
          })));
          const sprites = {
            road: textures.road, pavement: textures.pavement, water: textures.water,
            ground: { grass: textures.grass, field: textures.field, forest: textures.forest, urban: textures.urban },
            roofs: { tiles: textures.roofTiles, flat: textures.roofFlat },
          };
          const canvas = document.querySelector('canvas');
          canvas.width = 1200;
          canvas.height = 800;
          canvas.style.width = '1200px';
          canvas.style.height = '800px';
          const tile = decodeTile(rawTile, index);
          const raster = createStaticRaster(createDomCanvasFactory(), 128 * 1024 * 1024, () => sprites);
          const source = { raster, overhead: raster, tiles: [tile], landmarks: new Map(index.landmarks.map(l => [l.key, l])), loadedTileRects: [tile.rect] };
          for (let i = 0; i < 12; i++) drawVisibleChunks(canvas.getContext('2d'), { x: 2688.031, y: -640.047, zoom: 8.37 }, { width: 1200, height: 800 }, source);
          raster.dispose();
        };
        window.checkSeams = (dpr, scale, zoom, tilt) => {
          const canvas = document.querySelector('canvas');
          const size = { width: 640, height: 480 };
          canvas.width = size.width * dpr;
          canvas.height = size.height * dpr;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.scale(dpr, dpr);
          ctx.translate(size.width / 2, size.height / 2);
          ctx.rotate(tilt);
          ctx.translate(-size.width / 2, -size.height / 2);
          const raster = createStaticRaster(createDomCanvasFactory(), 100 * 1024 * 1024);
          raster.configure(100 * 1024 * 1024, scale);
          const source = {
            raster, overhead: raster, tiles: [], landmarks: new Map(),
            loadedTileRects: [{ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }],
          };
          const camera = { x: 0.031, y: -0.047, zoom, rasterZoom: 8 };
          for (let i = 0; i < 4; i++) drawVisibleChunks(ctx, camera, size, source);
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.restore();
          drawVisibleChunks(ctx, camera, size, source);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const reference = Array.from(pixels.slice((40 * canvas.width + 40) * 4, (40 * canvas.width + 40) * 4 + 4));
          let mismatches = 0;
          for (let y = 40; y < canvas.height - 40; y++)
            for (let x = 40; x < canvas.width - 40; x++)
              if (reference.some((value, channel) => Math.abs(pixels[(y * canvas.width + x) * 4 + channel] - value) > 1)) mismatches++;
          raster.dispose();
          return { dpr, scale, zoom, tilt, mismatches };
        };
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    alias: { "@sentry/nextjs": "@sentry/browser" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas style="width:640px;height:480px"></canvas>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const results = [];
    for (const dpr of [1, 1.25, 2])
      for (const scale of [0.5, 0.75, 1])
        for (const zoom of [6.83, 8, 10.37])
          for (const tilt of [0, 0.04])
            results.push(
              await page.evaluate(
                (args) => window.checkSeams(...args),
                [dpr, scale, zoom, tilt],
              ),
            );
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify(results, null, 2),
    );
    await page.screenshot({ path: path.join(output, "seams.png") });
    const failures = results.filter((result) => result.mismatches > 0);
    if (failures.length)
      throw new Error(
        `${failures.length}/${results.length} views have tile seams: ${JSON.stringify(failures[0])}`,
      );
    console.log(
      `${results.length} canvas views have no tile seams across zoom, display density, quality and rotation`,
    );
    const manifest = require("../../public/arena/sprites/manifest.json");
    const surfaces = Object.fromEntries(
      Object.entries(manifest.surfaces).map(([name, entry]) => [
        name,
        {
          ...entry,
          data: `data:image/png;base64,${fs.readFileSync(path.join("public", entry.file)).toString("base64")}`,
        },
      ]),
    );
    await page.setViewportSize({ width: 1220, height: 820 });
    await page.evaluate(
      ([index, tile, textures]) => window.previewMap(index, tile, textures),
      [
        require("../../public/arena/map/v3/index.json"),
        require("../../public/arena/map/v3/tile_4_1.json"),
        surfaces,
      ],
    );
    await page
      .locator("canvas")
      .screenshot({ path: path.join(output, "campus-seamless.png") });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
