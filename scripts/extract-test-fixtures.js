#!/usr/bin/env node

/**
 * Helper script to extract JSON from test fixture images and save them to expected JSON files.
 * This allows you to review the extracted data before committing it as expected values.
 *
 * Usage: node scripts/extract-test-fixtures.js
 *
 * Requirements:
 * - Next.js dev server must be running (npm run dev)
 * - OPENAI_API_KEY must be set in environment
 * - Node.js 18+ (for FormData and File support)
 */

const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.TEST_API_URL || "http://localhost:3000";
const FIXTURES_DIR = path.join(__dirname, "..", "tests", "fixtures");

const TEST_IMAGES = [
  { image: "Home-Match-1.JPG", expected: "home-match-1-expected.json" },
  { image: "Home-Match-2.JPG", expected: "home-match-2-expected.json" },
  { image: "Away-Match-1.JPG", expected: "away-match-1-expected.json" },
];

async function extractJsonFromImage(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath);

  // FormData and File are available in Node.js 18+
  const formData = new FormData();
  const file = new File([imageBuffer], fileName, { type: "image/jpeg" });
  formData.append("image", file);

  console.log(`Extracting JSON from ${fileName}...`);

  const response = await fetch(`${BASE_URL}/api/report/extract`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Extract failed for ${fileName}: ${response.status} ${errorText}`,
    );
  }

  const data = await response.json();
  return data.result;
}

async function main() {
  console.log("Extracting JSON from test fixture images...\n");
  console.log(`Using API URL: ${BASE_URL}\n`);

  for (const { image, expected } of TEST_IMAGES) {
    const imagePath = path.join(FIXTURES_DIR, image);
    const expectedPath = path.join(FIXTURES_DIR, expected);

    if (!fs.existsSync(imagePath)) {
      console.warn(`⚠️  Skipping ${image}: file not found`);
      continue;
    }

    try {
      const extractedJson = await extractJsonFromImage(imagePath);

      // Format JSON with 2-space indentation
      const formattedJson = JSON.stringify(extractedJson, null, 2);

      // Write to expected file
      fs.writeFileSync(expectedPath, formattedJson + "\n", "utf-8");

      console.log(`✅ Extracted and saved: ${expected}`);
      console.log(
        `   Teams: ${extractedJson.homeTeam} vs ${extractedJson.awayTeam}`,
      );
      console.log(
        `   Score: ${extractedJson.homeScore}-${extractedJson.awayScore}`,
      );
      console.log(`   Events: ${extractedJson.events?.length || 0}`);
      console.log();
    } catch (error) {
      console.error(`❌ Error processing ${image}:`, error.message);
      console.log();
    }
  }

  console.log(
    "Done! Please review the generated expected JSON files before committing.",
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
