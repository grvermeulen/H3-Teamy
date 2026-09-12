#!/usr/bin/env node
/**
 * Draws the tank's source sprite, `assets/arena/sprites/vehicle-tank.png`, from vector shapes:
 * a top-down tank, nose up, on a transparent ground, at the 1024 px the other sources ship at.
 * The rest of the art comes from an image generator; the tank is drawn here so it needs no
 * generator run and no licence row beyond this file. `scripts/generate-arena-sprites.js` packs
 * it onto the tank's 7 × 3.4 m box like every other vehicle. Run it after changing the drawing:
 * `node scripts/arena/draw-tank-sprite.js && npm run arena:build-sprites`.
 */
const path = require("path");
const sharp = require("sharp");

/** The tank's box in centimetres: 3.4 m wide, 7 m long including the barrel. */
const WIDTH_CM = 340;
const LENGTH_CM = 700;
/** Source height in pixels, matching the generated sources. */
const SOURCE_HEIGHT_PX = 1024;

const HULL = "#4f5d33";
const HULL_LIGHT = "#66753f";
const HULL_DARK = "#3a4525";
const TRACK = "#2b2b2b";
const TRACK_LINK = "#4a4a4a";
const TURRET = "#455230";
const TURRET_EDGE = "#2f3820";
const BARREL = "#3b3b3b";
const BARREL_EDGE = "#1f1f1f";
const HATCH = "#5c6a3c";

/** Track links: a short dark bar every 22 cm down each track. */
function trackLinks(x, width) {
  const links = [];
  for (let y = 118; y < 668; y += 22)
    links.push(
      `<rect x="${x}" y="${y}" width="${width}" height="8" rx="2" fill="${TRACK_LINK}"/>`,
    );
  return links.join("");
}

/** Engine-deck grille: four slats across the rear of the hull. */
function grille() {
  const slats = [];
  for (let y = 560; y <= 620; y += 20)
    slats.push(
      `<rect x="112" y="${y}" width="116" height="7" rx="3" fill="${HULL_DARK}"/>`,
    );
  return slats.join("");
}

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH_CM} ${LENGTH_CM}">
  <!-- tracks, the full 5.8 m of the hull -->
  <rect x="10" y="110" width="72" height="570" rx="26" fill="${TRACK}"/>
  <rect x="258" y="110" width="72" height="570" rx="26" fill="${TRACK}"/>
  ${trackLinks(22, 48)}
  ${trackLinks(270, 48)}
  <!-- hull between the tracks, glacis lighter at the nose -->
  <rect x="70" y="118" width="200" height="556" rx="18" fill="${HULL}"/>
  <path d="M 88 118 L 252 118 L 240 200 L 100 200 Z" fill="${HULL_LIGHT}"/>
  <rect x="88" y="200" width="164" height="6" fill="${HULL_DARK}"/>
  ${grille()}
  <!-- exhausts -->
  <rect x="86" y="640" width="22" height="34" rx="6" fill="${HULL_DARK}"/>
  <rect x="232" y="640" width="22" height="34" rx="6" fill="${HULL_DARK}"/>
  <!-- barrel: from the turret past the nose, with a muzzle brake at the tip -->
  <rect x="152" y="14" width="36" height="380" rx="8" fill="${BARREL}" stroke="${BARREL_EDGE}" stroke-width="4"/>
  <rect x="142" y="14" width="56" height="40" rx="8" fill="${BARREL}" stroke="${BARREL_EDGE}" stroke-width="4"/>
  <rect x="146" y="300" width="48" height="26" rx="6" fill="${BARREL_EDGE}"/>
  <!-- turret, set back of centre, with the commander's hatch -->
  <ellipse cx="170" cy="400" rx="92" ry="112" fill="${TURRET}" stroke="${TURRET_EDGE}" stroke-width="6"/>
  <ellipse cx="170" cy="392" rx="66" ry="84" fill="${HULL}"/>
  <circle cx="196" cy="420" r="26" fill="${HATCH}" stroke="${TURRET_EDGE}" stroke-width="4"/>
  <circle cx="196" cy="420" r="8" fill="${TURRET_EDGE}"/>
  <rect x="118" y="330" width="26" height="70" rx="6" fill="${HULL_DARK}"/>
</svg>`;

const output = path.join(
  __dirname,
  "..",
  "..",
  "assets",
  "arena",
  "sprites",
  "vehicle-tank.png",
);
const width = Math.round((SOURCE_HEIGHT_PX * WIDTH_CM) / LENGTH_CM);

sharp(Buffer.from(svg))
  .resize(width, SOURCE_HEIGHT_PX, { fit: "fill" })
  .png()
  .toFile(output)
  .then(() => console.log(`Wrote ${output} (${width} × ${SOURCE_HEIGHT_PX})`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
