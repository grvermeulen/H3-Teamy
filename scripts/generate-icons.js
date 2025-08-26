#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function main() {
  const src = path.join(__dirname, '..', 'public', 'logo.svg');
  const outDir = path.join(__dirname, '..', 'public', 'icons');
  const out = path.join(outDir, 'apple-touch-icon-180.png');
  if (!fs.existsSync(src)) {
    console.error('Missing public/logo.svg');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  await sharp(src).resize(180, 180).png().toFile(out);
  console.log('Wrote', out);
}

main().catch((e) => { console.error(e); process.exit(1); });


