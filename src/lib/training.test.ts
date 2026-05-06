import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultSeasonWindow,
  describeRelativeDay,
  generateTrainingDates,
  nextTrainingDate,
  splitTrainingSessionDatesForDisplay,
  toYMD,
} from "./training";

describe("toYMD", () => {
  it("formatteert datum als YYYY-MM-DD", () => {
    expect(toYMD(new Date(2026, 3, 11))).toBe("2026-04-11");
  });
});

describe("generateTrainingDates", () => {
  it("bevat alleen woensdag en vrijdag tussen twee data", () => {
    const from = new Date(2026, 0, 7);
    const to = new Date(2026, 0, 21);
    const dates = generateTrainingDates(from, to);
    expect(dates.length).toBeGreaterThan(0);
    for (const ymd of dates) {
      const [y, m, d] = ymd.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      const w = dt.getDay();
      expect(w === 3 || w === 5).toBe(true);
    }
  });
});

describe("nextTrainingDate", () => {
  // 2025-09 calendar reference:
  // Mon 1, Tue 2, Wed 3, Thu 4, Fri 5, Sat 6, Sun 7
  // Mon 8, Tue 9, Wed 10, Thu 11, Fri 12, Sat 13, Sun 14
  it("returns the same day when called on a Wednesday", () => {
    const wed = new Date(2025, 8, 3); // Wed 2025-09-03
    expect(toYMD(nextTrainingDate(wed)!)).toBe("2025-09-03");
  });

  it("returns the same day when called on a Friday", () => {
    const fri = new Date(2025, 8, 5);
    expect(toYMD(nextTrainingDate(fri)!)).toBe("2025-09-05");
  });

  it("returns Wednesday when called on the preceding Saturday", () => {
    const sat = new Date(2025, 8, 6);
    expect(toYMD(nextTrainingDate(sat)!)).toBe("2025-09-10");
  });

  it("returns Wednesday when called on a Sunday", () => {
    const sun = new Date(2025, 8, 7);
    expect(toYMD(nextTrainingDate(sun)!)).toBe("2025-09-10");
  });

  it("returns Wednesday when called on a Tuesday", () => {
    const tue = new Date(2025, 8, 9);
    expect(toYMD(nextTrainingDate(tue)!)).toBe("2025-09-10");
  });

  it("returns Friday when called on a Thursday", () => {
    const thu = new Date(2025, 8, 4);
    expect(toYMD(nextTrainingDate(thu)!)).toBe("2025-09-05");
  });
});

describe("describeRelativeDay", () => {
  const today = new Date(2025, 8, 6); // Saturday 2025-09-06
  it("returns 'vandaag' for the same day", () => {
    expect(describeRelativeDay(today, today)).toBe("vandaag");
  });
  it("returns 'morgen' for the next day", () => {
    expect(describeRelativeDay(new Date(2025, 8, 7), today)).toBe("morgen");
  });
  it("returns 'overmorgen' for two days out", () => {
    expect(describeRelativeDay(new Date(2025, 8, 8), today)).toBe("overmorgen");
  });
  it("returns the Dutch weekday name for further-out days", () => {
    expect(describeRelativeDay(new Date(2025, 8, 10), today)).toBe("woensdag");
    expect(describeRelativeDay(new Date(2025, 8, 12), today)).toBe("vrijdag");
  });
});

describe("defaultSeasonWindow", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gebruikt SEASON_START en SEASON_END wanneer beide gezet en geldig", () => {
    vi.stubEnv("SEASON_START", "01-09-2025");
    vi.stubEnv("SEASON_END", "30-06-2026");
    const w = defaultSeasonWindow();
    expect(w.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w.from < w.to).toBe(true);
  });

  it("verlengt met een jaar als alleen SEASON_START gezet is", () => {
    vi.stubEnv("SEASON_START", "01-07-2025");
    const w = defaultSeasonWindow();
    expect(w.from).toBe("2025-07-01");
    expect(w.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("trekt een jaar terug als alleen SEASON_END gezet is", () => {
    vi.stubEnv("SEASON_END", "30-06-2026");
    const w = defaultSeasonWindow();
    expect(w.to).toBe("2026-06-30");
    expect(w.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("valt terug op seizoen rond 1 juli zonder env", () => {
    const w = defaultSeasonWindow();
    expect(w.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w.from < w.to).toBe(true);
  });
});

describe("splitTrainingSessionDatesForDisplay", () => {
  it("houdt de laatste drie trainingen vóór vandaag zichtbaar en groepeert oudere", () => {
    const today = "2026-06-15";
    const dates = [
      "2026-05-06",
      "2026-05-08",
      "2026-05-13",
      "2026-05-15",
      "2026-06-03",
      "2026-06-05",
      "2026-06-17",
    ];
    const { recentPast, olderPast, upcoming } =
      splitTrainingSessionDatesForDisplay(dates, today, 3);
    expect(olderPast).toEqual(["2026-05-06", "2026-05-08", "2026-05-13"]);
    expect(recentPast).toEqual(["2026-05-15", "2026-06-03", "2026-06-05"]);
    expect(upcoming).toEqual(["2026-06-17"]);
  });
});
