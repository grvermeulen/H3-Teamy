import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSeasonWindow, generateTrainingDates, toYMD } from "./training";

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
