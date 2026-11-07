import type { TeamEvent } from "../types";
import { defaultSeasonWindowAt } from "./training";

const AMSTERDAM_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Wall-clock match day in Europe/Amsterdam as `YYYY-MM-DD`. */
export function matchDayAmsterdamYmd(startIso: string): string {
  return AMSTERDAM_YMD.format(new Date(startIso));
}

/** Human season label such as `2026–2027` from half-open `[from, to)` (juli–juni). */
export function matchSeasonYearRangeLabel(fromYmd: string, toYmd: string): string {
  const startYear = fromYmd.slice(0, 4);
  const endExclusiveYear = toYmd.slice(0, 4);
  if (startYear === endExclusiveYear) return startYear;
  return `${startYear}–${endExclusiveYear}`;
}

function previousSeasonWindow(current: {
  from: string;
  to: string;
}): { from: string; to: string } {
  const fromDate = new Date(
    Number(current.from.slice(0, 4)),
    Number(current.from.slice(5, 7)) - 1,
    Number(current.from.slice(8, 10)),
  );
  const prevFrom = new Date(fromDate);
  prevFrom.setFullYear(prevFrom.getFullYear() - 1);
  const prevTo = new Date(fromDate);
  const toYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: toYmd(prevFrom), to: toYmd(prevTo) };
}

export type MatchSeasonSplit = {
  currentSeason: TeamEvent[];
  previousSeason: TeamEvent[];
  currentHeading: string;
  previousHeading: string;
  currentWindow: { from: string; to: string };
};

function ymdInHalfOpenWindow(
  ymd: string,
  fromYmd: string,
  toYmd: string,
): boolean {
  return ymd >= fromYmd && ymd < toYmd;
}

/**
 * Splits wedstrijden in huidig en vorig sportseizoen (zelfde logica als trainingen).
 * Matchdag = Amsterdam-kalenderdag van `start`.
 */
export function splitTeamEventsByMatchSeason(
  events: TeamEvent[],
  referenceMs: number = Date.now(),
): MatchSeasonSplit {
  const currentWindow = defaultSeasonWindowAt(new Date(referenceMs));
  const previousWindow = previousSeasonWindow(currentWindow);
  const currentRange = matchSeasonYearRangeLabel(
    currentWindow.from,
    currentWindow.to,
  );
  const previousRange = matchSeasonYearRangeLabel(
    previousWindow.from,
    currentWindow.from,
  );

  const currentSeason: TeamEvent[] = [];
  const previousSeason: TeamEvent[] = [];

  for (const event of events) {
    const ymd = matchDayAmsterdamYmd(event.start);
    if (ymdInHalfOpenWindow(ymd, currentWindow.from, currentWindow.to)) {
      currentSeason.push(event);
    } else if (ymd < currentWindow.from) {
      previousSeason.push(event);
    }
  }

  currentSeason.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  previousSeason.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );

  return {
    currentSeason,
    previousSeason,
    currentHeading: `Dit seizoen (${currentRange})`,
    previousHeading: `Vorig seizoen (${previousRange})`,
    currentWindow,
  };
}
