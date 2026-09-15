const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("@playwright/test");

// Render the shipped geometry and packed sprites through the game's real canvas painters.
async function main() {
  const output = path.resolve("docs/tech/arena/landmark-enrichment");
  fs.mkdirSync(output, { recursive: true });
  const source = `
    import { paintChunk } from './src/lib/cityArena/render/drawStatic';
    import { paintCanopies } from './src/lib/cityArena/render/drawScenery';
    import { drawBasketball } from './src/lib/cityArena/render/drawBasketball';
    import { createSpriteStore } from './src/lib/cityArena/render/loadSprites';
    import { createDomCanvasFactory } from './src/lib/cityArena/render/canvasTypes';
    import { decodeTile } from './src/lib/cityArena/world/decode';
    import { LANDMARK_ACTIVITIES } from './src/lib/cityArena/world/landmarkActivities';
    import { BONUS_INFO } from './src/lib/cityArena/sim/landmarkBonuses';
    import { BASKETBALL_COURT_CENTRE } from './src/lib/cityArena/world/basketballCourt';
    import { createCollisionGrid } from './src/lib/cityArena/world/collisionGrid';
    import { nearbyLandmarkActivity } from './src/lib/cityArena/world/landmarkActivities';
    import { createArenaPlayer } from './src/lib/cityArena/sim/arena';
    const index = await (await fetch('/arena/map/v3/index.json')).json();
    const store = createSpriteStore({canvasFactory:createDomCanvasFactory()});
    await store.load();
    const sprites = store.current();
    const tiles = await Promise.all(index.tiles.map(async t => decodeTile(await (await fetch('/arena/map/v3/'+t.file)).json(), index)));
    const landmarks = new Map(index.landmarks.map(l=>[l.key,{name:l.name,style:l.style}]));
    const collision = createCollisionGrid(); tiles.forEach(tile=>collision.insertTile(tile));
    const reachable=[];
    for(const landmark of index.landmarks) {
      const [x,y]=landmark.center.map(n=>n/4);
      const candidates=[];
      for(let i=0;i<32;i++) candidates.push(collision.resolveCircle([x+Math.cos(i*Math.PI/16)*3,y+Math.sin(i*Math.PI/16)*3],0.4));
      const found=candidates.find(point=>nearbyLandmarkActivity(index,createArenaPlayer(point,0),collision)?.key===landmark.key);
      if(!found) throw new Error('Geen bereikbare interactie: '+landmark.key);
      reachable.push({key:landmark.key,point:found});
    }
    const courtPlayer=createArenaPlayer(collision.resolveCircle(BASKETBALL_COURT_CENTRE,0.4),0);
    if(nearbyLandmarkActivity(index,courtPlayer,collision)?.key!=='bellefleur-basketball') throw new Error('Basketbalinteractie niet bereikbaar');
    window.reachable=reachable;
    const views = [...index.landmarks.map(l => ({key:l.key,name:l.name,centre:l.center.map(n=>n/4)})),
      {key:'bellefleur-basketball',name:'Oranje op Bellefleur 5',centre:BASKETBALL_COURT_CENTRE},
      {key:'neighbourhood',name:'Daken en tuinen',centre:[2366,580]},
      {key:'meadow',name:'Groen rond de stad',centre:[2320,580]}];
    for(const view of views) {
      const article = document.createElement('article');
      const heading = document.createElement('h2'); heading.textContent=view.name;article.append(heading);
      const canvas=document.createElement('canvas');canvas.width=480;canvas.height=340;article.append(canvas);
      const building=tiles.flatMap(t=>t.buildings).find(b=>b.landmark===view.key);
      const span=building?Math.max(building.bounds.maxX-building.bounds.minX,building.bounds.maxY-building.bounds.minY):45;
      const zoom= view.key==='bellefleur-basketball' ? 12 : Math.min(12, 285/(span+12));
      const rect={minX:view.centre[0]-240/zoom,maxX:view.centre[0]+240/zoom,minY:view.centre[1]-170/zoom,maxY:view.centre[1]+170/zoom};
      const ctx=canvas.getContext('2d');const started=performance.now();
      paintChunk(ctx,rect,zoom,tiles,landmarks,sprites);
      paintCanopies(ctx,tiles,rect,sprites.props);
      ctx.setTransform(1,0,0,1,0,0);
      drawBasketball(ctx,{x:view.centre[0],y:view.centre[1],zoom},{width:480,height:340},9,sprites.landmarks['basketball-girls']);
      const elapsed=performance.now()-started;
      const activity=LANDMARK_ACTIVITIES[view.key];const p=document.createElement('p');
      p.textContent=activity?activity.action+' · '+BONUS_INFO[activity.bonus].detail+' · '+activity.seconds+' s':'Variatie in materialen, details en begroeiing';article.append(p);
      document.querySelector('main').append(article);
      (window.timings ??= []).push({key:view.key,ms:Math.round(elapsed*100)/100});
    }
    window.ready=true;
  `;
  const bundle = await build({
    stdin: {
      contents: source,
      resolveDir: process.cwd(),
      sourcefile: "landmark-preview.ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    plugins: [
      {
        name: "preview-telemetry",
        setup(build) {
          build.onResolve({ filter: /^@sentry\/nextjs$/ }, () => ({
            path: "telemetry",
            namespace: "preview",
          }));
          build.onLoad({ filter: /.*/, namespace: "preview" }, () => ({
            contents:
              "export function captureException(error) { console.error(error); }",
          }));
        },
      },
    ],
  });
  const html =
    '<!doctype html><html lang="nl"><meta charset="utf-8"><style>body{margin:0;padding:30px;background:#101b20;color:#ebeadc;font:14px system-ui}h1{font-size:28px;margin:0 0 8px}header p{color:#a3b7ad;margin:0 0 28px}main{display:grid;grid-template-columns:repeat(3,480px);gap:20px}article{background:#192a2c;border:1px solid #38504b;border-radius:12px;overflow:hidden}h2{font-size:17px;padding:0 16px}canvas{display:block}article p{padding:0 16px;min-height:35px;color:#b7d5be;font-size:12px}</style><header><h1>Een levendiger Wageningen, Rhenen en Bennekom</h1><p>Eigen plekken · lokale activiteiten · tijdelijke bonussen</p></header><main></main><script type="module" src="/preview.js"></script></html>';
  const publicDir = path.resolve("public");
  const server = http.createServer((req, res) => {
    if (req.url === "/favicon.ico") {
      res.statusCode = 204;
      return res.end();
    }
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      return res.end(html);
    }
    if (req.url === "/preview.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(bundle.outputFiles[0].text);
    }
    const file = path.resolve(
      publicDir,
      "." + decodeURIComponent(req.url.split("?")[0]),
    );
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".json") ? "application/json" : "image/png",
    );
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage({
      viewport: { width: 1544, height: 1100 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
    await page.screenshot({
      path: path.join(output, "map-gallery.png"),
      fullPage: true,
    });
    const timings = await page.evaluate(() => window.timings);
    const reachable = await page.evaluate(() => window.reachable);
    fs.writeFileSync(
      path.join(output, "render-check.json"),
      JSON.stringify({ errors, reachable, timings }, null, 2) + "\n",
    );
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      `Rendered ${timings.length} map views: ${path.join(output, "map-gallery.png")}`,
    );
  } finally {
    try {
      await browser?.close();
    } finally {
      server.close();
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
