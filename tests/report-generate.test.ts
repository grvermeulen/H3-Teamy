import { beforeEach, describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import {
  loadExpectedJson,
  extractGoalScorers,
  validateReportContent,
  type MatchJson,
} from "./utils/test-helpers";

const runReportE2E = process.env.RUN_REPORT_E2E === "1";
const reportDescribe = runReportE2E ? describe : describe.skip;

reportDescribe("Match Report Generate", () => {
  const baseUrl = process.env.TEST_API_URL || "http://localhost:3000";
  const requiredFixtures = [
    "tests/fixtures/home-match-1-expected.json",
    "tests/fixtures/away-match-1-expected.json",
  ];

  beforeEach(({ skip }) => {
    const missingFixtures = requiredFixtures.filter(
      (fixture) => !existsSync(join(process.cwd(), fixture)),
    );
    if (missingFixtures.length > 0) {
      skip(`Missing required fixtures: ${missingFixtures.join(", ")}`);
    }
  });

  describe("Home Match Report Generation", () => {
    it("should generate report from extracted JSON", async () => {
      const expectedPath = "tests/fixtures/home-match-1-expected.json";
      if (!existsSync(join(process.cwd(), expectedPath))) {
        console.warn(`Skipping test: ${expectedPath} not found.`);
        return;
      }

      const matchData = loadExpectedJson(expectedPath);
      const payload = {
        eventId: "test-home-" + Date.now(),
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        homeScore: matchData.homeScore,
        awayScore: matchData.awayScore,
        date: matchData.date,
        events: matchData.events,
      };

      const response = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.report).toBeDefined();
      expect(data.report.content).toBeDefined();
      expect(typeof data.report.content).toBe("string");
      expect(data.report.content.length).toBeGreaterThan(0);
    });

    it("should contain correct final score in report", async () => {
      const expectedPath = "tests/fixtures/home-match-1-expected.json";
      if (!existsSync(join(process.cwd(), expectedPath))) {
        console.warn(`Skipping test: ${expectedPath} not found.`);
        return;
      }

      const matchData = loadExpectedJson(expectedPath);
      const payload = {
        eventId: "test-home-" + Date.now(),
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        homeScore: matchData.homeScore,
        awayScore: matchData.awayScore,
        date: matchData.date,
        events: matchData.events,
      };

      const response = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const report = data.report.content as string;
      const expectedScore = `${matchData.homeScore}-${matchData.awayScore}`;
      expect(report.toLowerCase()).toContain(expectedScore);
    });

    it("should mention all home team goal scorers by name", async () => {
      const expectedPath = "tests/fixtures/home-match-1-expected.json";
      if (!existsSync(join(process.cwd(), expectedPath))) {
        console.warn(`Skipping test: ${expectedPath} not found.`);
        return;
      }

      const matchData = loadExpectedJson(expectedPath);
      const homeGoalScorers = extractGoalScorers(
        matchData.events || [],
        "home",
      );

      if (homeGoalScorers.length === 0) {
        console.warn("Skipping test: no home goal scorers in test data.");
        return;
      }

      const payload = {
        eventId: "test-home-" + Date.now(),
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        homeScore: matchData.homeScore,
        awayScore: matchData.awayScore,
        date: matchData.date,
        events: matchData.events,
      };

      const response = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const report = data.report.content as string;
      const lowerReport = report.toLowerCase();

      for (const scorer of homeGoalScorers) {
        expect(lowerReport).toContain(scorer.toLowerCase());
      }
    });

    it("should have report length between 140-220 words", async () => {
      const expectedPath = "tests/fixtures/home-match-1-expected.json";
      if (!existsSync(join(process.cwd(), expectedPath))) {
        console.warn(`Skipping test: ${expectedPath} not found.`);
        return;
      }

      const matchData = loadExpectedJson(expectedPath);
      const payload = {
        eventId: "test-home-" + Date.now(),
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        homeScore: matchData.homeScore,
        awayScore: matchData.awayScore,
        date: matchData.date,
        events: matchData.events,
      };

      const response = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const report = data.report.content as string;
      const wordCount = report.split(/\s+/).length;

      expect(wordCount).toBeGreaterThanOrEqual(140);
      expect(wordCount).toBeLessThanOrEqual(220);
    });

    it("should mention MVP from home team", async () => {
      const expectedPath = "tests/fixtures/home-match-1-expected.json";
      if (!existsSync(join(process.cwd(), expectedPath))) {
        console.warn(`Skipping test: ${expectedPath} not found.`);
        return;
      }

      const matchData = loadExpectedJson(expectedPath);
      const homePlayers = new Set<string>();
      (matchData.events || []).forEach((e) => {
        if (e.team === "home" && e.player) {
          homePlayers.add(e.player);
        }
      });

      if (homePlayers.size === 0) {
        console.warn("Skipping test: no home team players in test data.");
        return;
      }

      const payload = {
        eventId: "test-home-" + Date.now(),
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        homeScore: matchData.homeScore,
        awayScore: matchData.awayScore,
        date: matchData.date,
        events: matchData.events,
      };

      const response = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const report = data.report.content as string;
      const lowerReport = report.toLowerCase();

      const mvpMentioned = Array.from(homePlayers).some((player) =>
        lowerReport.includes(player.toLowerCase()),
      );
      expect(mvpMentioned).toBe(true);
    });
  });

  describe("Away Match Report Generation", () => {
    it("should generate report from away match JSON", async () => {
      const expectedPath = "tests/fixtures/away-match-1-expected.json";
      if (!existsSync(join(process.cwd(), expectedPath))) {
        console.warn(`Skipping test: ${expectedPath} not found.`);
        return;
      }

      const matchData = loadExpectedJson(expectedPath);
      const payload = {
        eventId: "test-away-" + Date.now(),
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        homeScore: matchData.homeScore,
        awayScore: matchData.awayScore,
        date: matchData.date,
        events: matchData.events,
      };

      const response = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.report).toBeDefined();
      expect(data.report.content).toBeDefined();
      expect(typeof data.report.content).toBe("string");
    });

    it("should be written from De Rijn Heren 3 perspective", async () => {
      const expectedPath = "tests/fixtures/away-match-1-expected.json";
      if (!existsSync(join(process.cwd(), expectedPath))) {
        console.warn(`Skipping test: ${expectedPath} not found.`);
        return;
      }

      const matchData = loadExpectedJson(expectedPath);
      const payload = {
        eventId: "test-away-" + Date.now(),
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        homeScore: matchData.homeScore,
        awayScore: matchData.awayScore,
        date: matchData.date,
        events: matchData.events,
      };

      const response = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const report = data.report.content as string;
      const lowerReport = report.toLowerCase();

      expect(matchData.awayTeam).toBe("De Rijn H3");
      expect(lowerReport).toContain("de rijn");
    });
  });

  describe("Report Content Validation", () => {
    it("should validate report content matches expected data", async () => {
      const expectedPath = "tests/fixtures/home-match-1-expected.json";
      if (!existsSync(join(process.cwd(), expectedPath))) {
        console.warn(`Skipping test: ${expectedPath} not found.`);
        return;
      }

      const matchData = loadExpectedJson(expectedPath);
      const payload = {
        eventId: "test-validation-" + Date.now(),
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        homeScore: matchData.homeScore,
        awayScore: matchData.awayScore,
        date: matchData.date,
        events: matchData.events,
      };

      const response = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const report = data.report.content as string;

      const validation = validateReportContent(report, matchData);
      if (!validation.valid) {
        console.error("Report validation errors:", validation.errors);
      }
      expect(validation.valid).toBe(true);
    });

    it("should be written in Dutch", async () => {
      const expectedPath = "tests/fixtures/home-match-1-expected.json";
      if (!existsSync(join(process.cwd(), expectedPath))) {
        console.warn(`Skipping test: ${expectedPath} not found.`);
        return;
      }

      const matchData = loadExpectedJson(expectedPath);
      const payload = {
        eventId: "test-dutch-" + Date.now(),
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        homeScore: matchData.homeScore,
        awayScore: matchData.awayScore,
        date: matchData.date,
        events: matchData.events,
      };

      const response = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const report = data.report.content as string;

      const dutchWords = [
        "de",
        "het",
        "een",
        "van",
        "op",
        "met",
        "voor",
        "zijn",
        "was",
        "waren",
      ];
      const lowerReport = report.toLowerCase();
      const containsDutch = dutchWords.some((word) =>
        lowerReport.includes(` ${word} `),
      );

      expect(containsDutch).toBe(true);
    });

    it("should not contain incorrect scores", async () => {
      const expectedPath = "tests/fixtures/home-match-1-expected.json";
      if (!existsSync(join(process.cwd(), expectedPath))) {
        console.warn(`Skipping test: ${expectedPath} not found.`);
        return;
      }

      const matchData = loadExpectedJson(expectedPath);
      const payload = {
        eventId: "test-scores-" + Date.now(),
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        homeScore: matchData.homeScore,
        awayScore: matchData.awayScore,
        date: matchData.date,
        events: matchData.events,
      };

      const response = await fetch(`${baseUrl}/api/report/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const report = data.report.content as string;
      const expectedScore = `${matchData.homeScore}-${matchData.awayScore}`;
      const wrongScore1 = `${matchData.homeScore + 1}-${matchData.awayScore}`;
      const wrongScore2 = `${matchData.homeScore}-${matchData.awayScore + 1}`;

      expect(report).toContain(expectedScore);
      expect(report).not.toContain(wrongScore1);
      expect(report).not.toContain(wrongScore2);
    });
  });
});
