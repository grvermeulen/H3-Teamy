import { readFileSync } from "fs";
import { join } from "path";

export type MatchEvent = {
  quarter: 1 | 2 | 3 | 4;
  time?: string;
  team: "home" | "away";
  type: "goal" | "personal_foul";
  player?: string;
};

export type MatchJson = {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  date?: string;
  events?: MatchEvent[];
};

export function loadTestImage(imagePath: string): File {
  const fullPath = join(process.cwd(), imagePath);
  const buffer = readFileSync(fullPath);
  const fileName = imagePath.split("/").pop() || "test.png";
  const extension = fileName.split(".").pop()?.toLowerCase() || "png";
  const mimeType =
    extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "image/png";
  const blob = new Blob([buffer], { type: mimeType });
  return new File([blob], fileName, { type: mimeType });
}

export function validateMatchJson(json: any): json is MatchJson {
  if (!json || typeof json !== "object") return false;
  if (typeof json.homeTeam !== "string") return false;
  if (typeof json.awayTeam !== "string") return false;
  if (typeof json.homeScore !== "number") return false;
  if (typeof json.awayScore !== "number") return false;
  if (json.date !== undefined && typeof json.date !== "string") return false;

  if (json.events !== undefined) {
    if (!Array.isArray(json.events)) return false;
    for (const event of json.events) {
      if (!validateMatchEvent(event)) return false;
    }
  }

  return true;
}

function validateMatchEvent(event: any): event is MatchEvent {
  if (!event || typeof event !== "object") return false;
  if (![1, 2, 3, 4].includes(event.quarter)) return false;
  if (event.time !== undefined && typeof event.time !== "string") return false;
  if (event.team !== "home" && event.team !== "away") return false;
  if (event.type !== "goal" && event.type !== "personal_foul") return false;
  if (event.player !== undefined && typeof event.player !== "string")
    return false;
  return true;
}

export function extractGoalScorers(
  events: MatchEvent[],
  team: "home" | "away",
): string[] {
  const scorers = events
    .filter((e) => e.type === "goal" && e.team === team && e.player)
    .map((e) => e.player!)
    .filter((name, index, arr) => arr.indexOf(name) === index);
  return scorers;
}

export function validateReportContent(
  report: string,
  expectedData: MatchJson,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const lowerReport = report.toLowerCase();

  const expectedScore = `${expectedData.homeScore}-${expectedData.awayScore}`;
  if (!lowerReport.includes(expectedScore)) {
    errors.push(`Report does not contain expected score: ${expectedScore}`);
  }

  const homeGoalScorers = extractGoalScorers(expectedData.events || [], "home");
  for (const scorer of homeGoalScorers) {
    if (!lowerReport.includes(scorer.toLowerCase())) {
      errors.push(`Report does not mention goal scorer: ${scorer}`);
    }
  }

  const wordCount = report.split(/\s+/).length;
  if (wordCount < 140 || wordCount > 220) {
    errors.push(
      `Report word count (${wordCount}) is outside expected range (140-220)`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function loadExpectedJson(filePath: string): MatchJson {
  const fullPath = join(process.cwd(), filePath);
  const content = readFileSync(fullPath, "utf-8");
  const json = JSON.parse(content);
  if (!validateMatchJson(json)) {
    throw new Error(`Invalid JSON structure in ${filePath}`);
  }
  return json;
}

export function compareMatchJson(
  actual: MatchJson,
  expected: MatchJson,
): { match: boolean; differences: string[] } {
  const differences: string[] = [];

  if (actual.homeTeam !== expected.homeTeam) {
    differences.push(
      `homeTeam mismatch: expected "${expected.homeTeam}", got "${actual.homeTeam}"`,
    );
  }
  if (actual.awayTeam !== expected.awayTeam) {
    differences.push(
      `awayTeam mismatch: expected "${expected.awayTeam}", got "${actual.awayTeam}"`,
    );
  }
  if (actual.homeScore !== expected.homeScore) {
    differences.push(
      `homeScore mismatch: expected ${expected.homeScore}, got ${actual.homeScore}`,
    );
  }
  if (actual.awayScore !== expected.awayScore) {
    differences.push(
      `awayScore mismatch: expected ${expected.awayScore}, got ${actual.awayScore}`,
    );
  }

  const actualEvents = actual.events || [];
  const expectedEvents = expected.events || [];

  if (actualEvents.length !== expectedEvents.length) {
    differences.push(
      `Event count mismatch: expected ${expectedEvents.length}, got ${actualEvents.length}`,
    );
  } else {
    for (let i = 0; i < expectedEvents.length; i++) {
      const exp = expectedEvents[i];
      const act = actualEvents[i];
      if (exp.quarter !== act.quarter) {
        differences.push(
          `Event ${i} quarter mismatch: expected ${exp.quarter}, got ${act.quarter}`,
        );
      }
      if (exp.team !== act.team) {
        differences.push(
          `Event ${i} team mismatch: expected ${exp.team}, got ${act.team}`,
        );
      }
      if (exp.type !== act.type) {
        differences.push(
          `Event ${i} type mismatch: expected ${exp.type}, got ${act.type}`,
        );
      }
      if (exp.player !== act.player) {
        differences.push(
          `Event ${i} player mismatch: expected "${exp.player}", got "${act.player}"`,
        );
      }
    }
  }

  return {
    match: differences.length === 0,
    differences,
  };
}
