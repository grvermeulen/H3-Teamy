import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import {
  loadTestImage,
  loadExpectedJson,
  validateMatchJson,
  validateReportContent,
  compareMatchJson,
  type MatchJson,
} from "./utils/test-helpers";

describe("Match Report Integration", () => {
  const baseUrl = process.env.TEST_API_URL || "http://localhost:3000";

  describe("Full Pipeline: Image to Report", () => {
    it("should extract JSON and generate report from home match image 1", async () => {
      const imagePath = "tests/fixtures/Home-Match-1.JPG";
      const expectedPath = "tests/fixtures/home-match-1-expected.json";

      if (!existsSync(join(process.cwd(), imagePath))) {
        console.warn(
          `Skipping test: ${imagePath} not found. Please add the test image.`,
        );
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const extractResponse = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(extractResponse.ok).toBe(true);
      const extractData = await extractResponse.json();
      const extractedJson = extractData.result as MatchJson;

      expect(validateMatchJson(extractedJson)).toBe(true);

      if (existsSync(join(process.cwd(), expectedPath))) {
        const expectedJson = loadExpectedJson(expectedPath);
        const comparison = compareMatchJson(extractedJson, expectedJson);
        if (!comparison.match) {
          console.warn(
            "Extracted JSON differs from expected:",
            comparison.differences,
          );
        }
      }

      const generatePayload = {
        eventId: "test-integration-" + Date.now(),
        homeTeam: extractedJson.homeTeam,
        awayTeam: extractedJson.awayTeam,
        homeScore: extractedJson.homeScore,
        awayScore: extractedJson.awayScore,
        date: extractedJson.date,
        events: extractedJson.events,
      };

      const generateResponse = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(generatePayload),
      });

      expect(generateResponse.ok).toBe(true);
      const generateData = await generateResponse.json();
      expect(generateData.report).toBeDefined();
      expect(generateData.report.content).toBeDefined();

      const report = generateData.report.content as string;
      expect(report.length).toBeGreaterThan(0);

      const validation = validateReportContent(report, extractedJson);
      if (!validation.valid) {
        console.warn("Report validation warnings:", validation.errors);
      }
    });

    it("should extract JSON and generate report from away match image", async () => {
      const imagePath = "tests/fixtures/Away-Match-1.JPG";
      const expectedPath = "tests/fixtures/away-match-1-expected.json";

      if (!existsSync(join(process.cwd(), imagePath))) {
        console.warn(
          `Skipping test: ${imagePath} not found. Please add the test image.`,
        );
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const extractResponse = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(extractResponse.ok).toBe(true);
      const extractData = await extractResponse.json();
      const extractedJson = extractData.result as MatchJson;

      expect(validateMatchJson(extractedJson)).toBe(true);
      expect(extractedJson.awayTeam).toBe("De Rijn H3");

      if (existsSync(join(process.cwd(), expectedPath))) {
        const expectedJson = loadExpectedJson(expectedPath);
        const comparison = compareMatchJson(extractedJson, expectedJson);
        if (!comparison.match) {
          console.warn(
            "Extracted JSON differs from expected:",
            comparison.differences,
          );
        }
      }

      const generatePayload = {
        eventId: "test-integration-away-" + Date.now(),
        homeTeam: extractedJson.homeTeam,
        awayTeam: extractedJson.awayTeam,
        homeScore: extractedJson.homeScore,
        awayScore: extractedJson.awayScore,
        date: extractedJson.date,
        events: extractedJson.events,
      };

      const generateResponse = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(generatePayload),
      });

      expect(generateResponse.ok).toBe(true);
      const generateData = await generateResponse.json();
      expect(generateData.report).toBeDefined();
      expect(generateData.report.content).toBeDefined();

      const report = generateData.report.content as string;
      expect(report.length).toBeGreaterThan(0);
    });

    it("should maintain data consistency between extraction and generation", async () => {
      const imagePath = "tests/fixtures/Home-Match-1.JPG";

      if (!existsSync(join(process.cwd(), imagePath))) {
        console.warn(`Skipping test: ${imagePath} not found.`);
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const extractResponse = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(extractResponse.ok).toBe(true);
      const extractData = await extractResponse.json();
      const extractedJson = extractData.result as MatchJson;

      const generatePayload = {
        eventId: "test-consistency-" + Date.now(),
        homeTeam: extractedJson.homeTeam,
        awayTeam: extractedJson.awayTeam,
        homeScore: extractedJson.homeScore,
        awayScore: extractedJson.awayScore,
        date: extractedJson.date,
        events: extractedJson.events,
      };

      const generateResponse = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(generatePayload),
      });

      expect(generateResponse.ok).toBe(true);
      const generateData = await generateResponse.json();
      const report = generateData.report.content as string;

      const expectedScore = `${extractedJson.homeScore}-${extractedJson.awayScore}`;
      expect(report).toContain(expectedScore);

      const homeGoalScorers = (extractedJson.events || [])
        .filter((e) => e.type === "goal" && e.team === "home" && e.player)
        .map((e) => e.player!)
        .filter((name, index, arr) => arr.indexOf(name) === index);

      const lowerReport = report.toLowerCase();
      for (const scorer of homeGoalScorers) {
        expect(lowerReport).toContain(scorer.toLowerCase());
      }
    });

    it("should extract JSON and generate report from home match image 2", async () => {
      const imagePath = "tests/fixtures/Home-Match-2.JPG";
      const expectedPath = "tests/fixtures/home-match-2-expected.json";

      if (!existsSync(join(process.cwd(), imagePath))) {
        console.warn(
          `Skipping test: ${imagePath} not found. Please add the test image.`,
        );
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const extractResponse = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(extractResponse.ok).toBe(true);
      const extractData = await extractResponse.json();
      const extractedJson = extractData.result as MatchJson;

      expect(validateMatchJson(extractedJson)).toBe(true);

      if (existsSync(join(process.cwd(), expectedPath))) {
        const expectedJson = loadExpectedJson(expectedPath);
        const comparison = compareMatchJson(extractedJson, expectedJson);
        if (!comparison.match) {
          console.warn(
            "Extracted JSON differs from expected:",
            comparison.differences,
          );
        }
      }

      const generatePayload = {
        eventId: "test-integration-home2-" + Date.now(),
        homeTeam: extractedJson.homeTeam,
        awayTeam: extractedJson.awayTeam,
        homeScore: extractedJson.homeScore,
        awayScore: extractedJson.awayScore,
        date: extractedJson.date,
        events: extractedJson.events,
      };

      const generateResponse = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(generatePayload),
      });

      expect(generateResponse.ok).toBe(true);
      const generateData = await generateResponse.json();
      expect(generateData.report).toBeDefined();
      expect(generateData.report.content).toBeDefined();

      const report = generateData.report.content as string;
      expect(report.length).toBeGreaterThan(0);

      const validation = validateReportContent(report, extractedJson);
      if (!validation.valid) {
        console.warn("Report validation warnings:", validation.errors);
      }
    });
  });
});
