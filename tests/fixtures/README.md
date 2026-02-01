# Test Fixtures

This directory contains test fixtures for match report generation testing.

## Required Files

- `Home-Match-1.JPG` - Screenshot of a home match (De Rijn H3 playing at home) - Image 1
- `Home-Match-2.JPG` - Screenshot of a home match (De Rijn H3 playing at home) - Image 2
- `Away-Match-1.JPG` - Screenshot of an away match (De Rijn H3 playing away)
- `home-match-1-expected.json` - Expected JSON output for Home-Match-1.JPG extraction
- `home-match-2-expected.json` - Expected JSON output for Home-Match-2.JPG extraction
- `away-match-1-expected.json` - Expected JSON output for Away-Match-1.JPG extraction

## Setup

1. Match screenshots are already in this directory:
   - `Home-Match-1.JPG` - First home match screenshot
   - `Home-Match-2.JPG` - Second home match screenshot
   - `Away-Match-1.JPG` - Away match screenshot

2. Generate expected JSON files:
   ```bash
   npm run test:extract-fixtures
   ```
   This will extract JSON from all images and save them to the expected JSON files.
   Review the generated files to ensure they're correct before committing.

## Running Tests

Before running tests, ensure:

1. The Next.js development server is running (`npm run dev`)
2. Environment variables are set:
   - `OPENAI_API_KEY` - Required for report generation
   - `OCR_SPACE_API_KEY` - Optional, for OCR fallback

Then run:

```bash
npm run test:run
```

## Note

Tests will make real API calls to OpenAI, which will incur costs. Run tests intentionally, not in CI by default.
