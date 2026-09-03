#!/usr/bin/env node
/**
 * Generates app icons and optimised splash images from the branding sources in assets/branding/.
 * Runs as `prebuild`; run manually with `node scripts/generate-icons.js` after replacing artwork.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const sources = {
  logo: path.join(root, "assets", "branding", "logo-h3.png"),
  splashApp: path.join(root, "assets", "branding", "splash-app-portrait.png"),
  splashGame: path.join(
    root,
    "assets",
    "branding",
    "splash-game-landscape.png",
  ),
};
const iconsDir = path.join(root, "public", "icons");
const brandingDir = path.join(root, "public", "branding");

async function main() {
  for (const file of Object.values(sources)) {
    if (!fs.existsSync(file)) {
      console.error(`Missing branding source ${file}`);
      process.exit(1);
    }
  }
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.mkdirSync(brandingDir, { recursive: true });

  const logo = sharp(sources.logo);
  await logo
    .clone()
    .resize(180, 180)
    .png()
    .toFile(path.join(iconsDir, "apple-touch-icon-180.png"));
  await logo
    .clone()
    .resize(192, 192)
    .png()
    .toFile(path.join(iconsDir, "icon-192.png"));
  await logo
    .clone()
    .resize(512, 512)
    .png()
    .toFile(path.join(iconsDir, "icon-512.png"));
  await logo
    .clone()
    .resize(256, 256)
    .png()
    .toFile(path.join(root, "public", "logo.png"));
  await logo
    .clone()
    .resize(256, 256)
    .png()
    .toFile(path.join(root, "src", "app", "icon.png"));

  // Maskable icon: badge at 80 % on a black canvas so circular masks keep the safe zone.
  const badge = await logo.clone().resize(410, 410).png().toBuffer();
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: "#000000" },
  })
    .composite([{ input: badge, gravity: "centre" }])
    .png()
    .toFile(path.join(iconsDir, "icon-maskable-512.png"));

  const splashApp = sharp(sources.splashApp).resize({ width: 1080 });
  await splashApp
    .clone()
    .webp({ quality: 82 })
    .toFile(path.join(brandingDir, "splash-app-portrait.webp"));
  await splashApp
    .clone()
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(path.join(brandingDir, "splash-app-portrait.jpg"));

  const splashGame = sharp(sources.splashGame).resize({ width: 1920 });
  await splashGame
    .clone()
    .webp({ quality: 80 })
    .toFile(path.join(brandingDir, "splash-game-landscape.webp"));
  await splashGame
    .clone()
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(path.join(brandingDir, "splash-game-landscape.jpg"));

  console.log(
    "Branding assets written to public/icons, public/branding, public/logo.png, src/app/icon.png",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
