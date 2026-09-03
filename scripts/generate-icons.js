#!/usr/bin/env node
/**
 * Generates app icons and optimised splash images from the branding sources in assets/branding/.
 * Runs as `prebuild`; run manually with `node scripts/generate-icons.js` after replacing artwork.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// Icon and splash dimensions, in pixels.
const APPLE_TOUCH_ICON_SIZE = 180;
const ICON_SIZES = [192, 512];
const LOGO_PNG_SIZE = 256;
const MASKABLE_CANVAS_SIZE = 512;
const MASKABLE_BADGE_SIZE = 410; // 80 % safe zone so circular masks keep the badge visible.
const SPLASH_APP_WIDTH = 1080;
const SPLASH_GAME_WIDTH = 1920;

// Output compression settings.
const WEBP_QUALITY_APP = 82;
const WEBP_QUALITY_GAME = 80;
const JPEG_QUALITY = 80;

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
    .resize(APPLE_TOUCH_ICON_SIZE, APPLE_TOUCH_ICON_SIZE)
    .png()
    .toFile(path.join(iconsDir, "apple-touch-icon-180.png"));
  for (const size of ICON_SIZES) {
    await logo
      .clone()
      .resize(size, size)
      .png()
      .toFile(path.join(iconsDir, `icon-${size}.png`));
  }
  await logo
    .clone()
    .resize(LOGO_PNG_SIZE, LOGO_PNG_SIZE)
    .png()
    .toFile(path.join(root, "public", "logo.png"));
  await logo
    .clone()
    .resize(LOGO_PNG_SIZE, LOGO_PNG_SIZE)
    .png()
    .toFile(path.join(root, "src", "app", "icon.png"));

  // Maskable icon: badge at 80 % on a black canvas so circular masks keep the safe zone.
  const badge = await logo
    .clone()
    .resize(MASKABLE_BADGE_SIZE, MASKABLE_BADGE_SIZE)
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: MASKABLE_CANVAS_SIZE,
      height: MASKABLE_CANVAS_SIZE,
      channels: 4,
      background: "#000000",
    },
  })
    .composite([{ input: badge, gravity: "centre" }])
    .png()
    .toFile(path.join(iconsDir, "icon-maskable-512.png"));

  const splashApp = sharp(sources.splashApp).resize({
    width: SPLASH_APP_WIDTH,
  });
  await splashApp
    .clone()
    .webp({ quality: WEBP_QUALITY_APP })
    .toFile(path.join(brandingDir, "splash-app-portrait.webp"));
  await splashApp
    .clone()
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(path.join(brandingDir, "splash-app-portrait.jpg"));

  const splashGame = sharp(sources.splashGame).resize({
    width: SPLASH_GAME_WIDTH,
  });
  await splashGame
    .clone()
    .webp({ quality: WEBP_QUALITY_GAME })
    .toFile(path.join(brandingDir, "splash-game-landscape.webp"));
  await splashGame
    .clone()
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(path.join(brandingDir, "splash-game-landscape.jpg"));

  console.log(
    "Branding assets written to public/icons, public/branding, public/logo.png, src/app/icon.png",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
