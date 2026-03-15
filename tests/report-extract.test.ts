import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  loadTestImage,
  validateMatchJson,
  compareMatchJson,
  loadExpectedJson,
  type MatchJson,
} from "./utils/test-helpers";

const runReportE2E = process.env.RUN_REPORT_E2E === "1";
const reportDescribe = runReportE2E ? describe : describe.skip;

reportDescribe("Match Report Extract", () => {
  const baseUrl = process.env.TEST_API_URL || "http://localhost:3000";

  describe("Home Match Extraction", () => {
    it("should extract JSON from home match image 1", async () => {
      const imagePath = "tests/fixtures/Home-Match-1.JPG";
      if (!existsSync(join(process.cwd(), imagePath))) {
        console.warn(
          `Skipping test: ${imagePath} not found. Please add the test image.`,
        );
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const response = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.result).toBeDefined();

      const extractedJson = data.result as MatchJson;
      expect(validateMatchJson(extractedJson)).toBe(true);
    });

    it("should match expected JSON structure for home match 1", async () => {
      const imagePath = "tests/fixtures/Home-Match-1.JPG";
      const expectedPath = "tests/fixtures/home-match-1-expected.json";

      if (!existsSync(join(process.cwd(), imagePath))) {
        console.warn(
          `Skipping test: ${imagePath} not found. Please add the test image.`,
        );
        return;
      }

      if (!existsSync(join(process.cwd(), expectedPath))) {
        console.warn(
          `Skipping test: ${expectedPath} not found. Please add the expected JSON.`,
        );
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const response = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const extractedJson = data.result as MatchJson;
      const expectedJson = loadExpectedJson(expectedPath);

      const comparison = compareMatchJson(extractedJson, expectedJson);
      if (!comparison.match) {
        console.error("JSON differences:", comparison.differences);
      }
      expect(comparison.match).toBe(true);
    });

    it("should have correct home team and away team for home match 1", async () => {
      const imagePath = "tests/fixtures/Home-Match-1.JPG";
      const expectedPath = "tests/fixtures/home-match-1-expected.json";

      if (
        !existsSync(join(process.cwd(), imagePath)) ||
        !existsSync(join(process.cwd(), expectedPath))
      ) {
        console.warn("Skipping test: test fixtures not found.");
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const response = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const extractedJson = data.result as MatchJson;
      const expectedJson = loadExpectedJson(expectedPath);

      expect(extractedJson.homeTeam).toBe(expectedJson.homeTeam);
      expect(extractedJson.awayTeam).toBe(expectedJson.awayTeam);
    });

    it("should have correct scores for home match 1", async () => {
      const imagePath = "tests/fixtures/Home-Match-1.JPG";
      const expectedPath = "tests/fixtures/home-match-1-expected.json";

      if (
        !existsSync(join(process.cwd(), imagePath)) ||
        !existsSync(join(process.cwd(), expectedPath))
      ) {
        console.warn("Skipping test: test fixtures not found.");
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const response = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const extractedJson = data.result as MatchJson;
      const expectedJson = loadExpectedJson(expectedPath);

      expect(extractedJson.homeScore).toBe(expectedJson.homeScore);
      expect(extractedJson.awayScore).toBe(expectedJson.awayScore);
    });

    it("should extract all events with correct structure for home match 1", async () => {
      const imagePath = "tests/fixtures/Home-Match-1.JPG";
      const expectedPath = "tests/fixtures/home-match-1-expected.json";

      if (
        !existsSync(join(process.cwd(), imagePath)) ||
        !existsSync(join(process.cwd(), expectedPath))
      ) {
        console.warn("Skipping test: test fixtures not found.");
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const response = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const extractedJson = data.result as MatchJson;
      const expectedJson = loadExpectedJson(expectedPath);

      expect(extractedJson.events?.length).toBe(expectedJson.events?.length);
      if (extractedJson.events && expectedJson.events) {
        for (let i = 0; i < expectedJson.events.length; i++) {
          const exp = expectedJson.events[i];
          const act = extractedJson.events[i];
          expect(act.quarter).toBe(exp.quarter);
          expect(act.team).toBe(exp.team);
          expect(act.type).toBe(exp.type);
          if (exp.player) {
            expect(act.player).toBe(exp.player);
          }
        }
      }
    });

    it("should extract JSON from home match image 2", async () => {
      const imagePath = "tests/fixtures/Home-Match-2.JPG";
      if (!existsSync(join(process.cwd(), imagePath))) {
        console.warn(
          `Skipping test: ${imagePath} not found. Please add the test image.`,
        );
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const response = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.result).toBeDefined();

      const extractedJson = data.result as MatchJson;
      expect(validateMatchJson(extractedJson)).toBe(true);
    });
  });

  describe("Away Match Extraction", () => {
    it("should extract JSON from away match image", async () => {
      const imagePath = "tests/fixtures/Away-Match-1.JPG";
      if (!existsSync(join(process.cwd(), imagePath))) {
        console.warn(
          `Skipping test: ${imagePath} not found. Please add the test image.`,
        );
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const response = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.result).toBeDefined();

      const extractedJson = data.result as MatchJson;
      expect(validateMatchJson(extractedJson)).toBe(true);
    });

    it("should match expected JSON structure for away match", async () => {
      const imagePath = "tests/fixtures/Away-Match-1.JPG";
      const expectedPath = "tests/fixtures/away-match-1-expected.json";

      if (
        !existsSync(join(process.cwd(), imagePath)) ||
        !existsSync(join(process.cwd(), expectedPath))
      ) {
        console.warn("Skipping test: test fixtures not found.");
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const response = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const extractedJson = data.result as MatchJson;
      const expectedJson = loadExpectedJson(expectedPath);

      const comparison = compareMatchJson(extractedJson, expectedJson);
      if (!comparison.match) {
        console.error("JSON differences:", comparison.differences);
      }
      expect(comparison.match).toBe(true);
    });

    it("should correctly identify home vs away teams for away match", async () => {
      const imagePath = "tests/fixtures/Away-Match-1.JPG";
      const expectedPath = "tests/fixtures/away-match-1-expected.json";

      if (
        !existsSync(join(process.cwd(), imagePath)) ||
        !existsSync(join(process.cwd(), expectedPath))
      ) {
        console.warn("Skipping test: test fixtures not found.");
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const response = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const extractedJson = data.result as MatchJson;
      const expectedJson = loadExpectedJson(expectedPath);

      expect(extractedJson.homeTeam).toBe(expectedJson.homeTeam);
      expect(extractedJson.awayTeam).toBe(expectedJson.awayTeam);
      expect(extractedJson.awayTeam).toBe("De Rijn H3");
    });
  });

  describe("JSON Schema Validation", () => {
    it("should validate required fields are present", async () => {
      const imagePath = "tests/fixtures/Home-Match-1.JPG";
      if (!existsSync(join(process.cwd(), imagePath))) {
        console.warn(`Skipping test: ${imagePath} not found.`);
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const response = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const extractedJson = data.result as MatchJson;

      expect(extractedJson.homeTeam).toBeDefined();
      expect(extractedJson.awayTeam).toBeDefined();
      expect(extractedJson.homeScore).toBeDefined();
      expect(extractedJson.awayScore).toBeDefined();
      expect(typeof extractedJson.homeTeam).toBe("string");
      expect(typeof extractedJson.awayTeam).toBe("string");
      expect(typeof extractedJson.homeScore).toBe("number");
      expect(typeof extractedJson.awayScore).toBe("number");
    });

    it("should validate event structure", async () => {
      const imagePath = "tests/fixtures/Home-Match-1.JPG";
      if (!existsSync(join(process.cwd(), imagePath))) {
        console.warn(`Skipping test: ${imagePath} not found.`);
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const response = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const extractedJson = data.result as MatchJson;

      if (extractedJson.events && extractedJson.events.length > 0) {
        for (const event of extractedJson.events) {
          expect([1, 2, 3, 4]).toContain(event.quarter);
          expect(["home", "away"]).toContain(event.team);
          expect(["goal", "personal_foul"]).toContain(event.type);
          if (event.time) {
            expect(typeof event.time).toBe("string");
          }
          if (event.player) {
            expect(typeof event.player).toBe("string");
          }
        }
      }
    });

    it("should have events sorted by quarter and time", async () => {
      const imagePath = "tests/fixtures/Home-Match-1.JPG";
      if (!existsSync(join(process.cwd(), imagePath))) {
        console.warn(`Skipping test: ${imagePath} not found.`);
        return;
      }

      const imageFile = loadTestImage(imagePath);
      const formData = new FormData();
      formData.append("image", imageFile);

      const response = await fetch(`${baseUrl}/api/report/extract`, {
        method: "POST",
        body: formData,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const extractedJson = data.result as MatchJson;

      if (extractedJson.events && extractedJson.events.length > 1) {
        for (let i = 1; i < extractedJson.events.length; i++) {
          const prev = extractedJson.events[i - 1];
          const curr = extractedJson.events[i];
          expect(curr.quarter).toBeGreaterThanOrEqual(prev.quarter);
          if (curr.quarter === prev.quarter && prev.time && curr.time) {
            const prevTime = parseTime(prev.time);
            const currTime = parseTime(curr.time);
            expect(currTime).toBeGreaterThanOrEqual(prevTime);
          }
        }
      }
    });
  });
});

function parseTime(timeStr: string): number {
  const parts = timeStr.split(":");
  if (parts.length !== 2) return 0;
  const minutes = parseInt(parts[0], 10);
  const seconds = parseInt(parts[1], 10);
  return minutes * 60 + seconds;
}
