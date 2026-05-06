export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDdMmYyyy(input: string | undefined | null): Date | null {
  if (!input) return null;
  const s = String(input).trim();
  // Accept dd-mm-yyyy or dd/mm/yyyy
  const m = s.match(/^([0-3]?\d)[-\/](0?\d|1[0-2])[-\/]((?:19|20)\d{2})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  // JS Date months are 0-based
  const date = new Date(yyyy, mm - 1, dd);
  // Validate that Date did not overflow (e.g., 31-02-2025)
  if (
    date.getFullYear() !== yyyy ||
    date.getMonth() !== mm - 1 ||
    date.getDate() !== dd
  )
    return null;
  return date;
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

export function generateTrainingDates(from: Date, to: Date): string[] {
  const dates: string[] = [];
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const weekday = d.getDay(); // 0=Sun, 3=Wed, 5=Fri
    if (weekday === 3 || weekday === 5) {
      dates.push(toYMD(new Date(d)));
    }
  }
  return dates;
}

export function defaultSeasonWindow(): { from: string; to: string } {
  const envStart = parseDdMmYyyy(process.env.SEASON_START);
  const envEnd = parseDdMmYyyy(process.env.SEASON_END);

  if (envStart && envEnd && envStart < envEnd) {
    return { from: toYMD(envStart), to: toYMD(envEnd) };
  }
  if (envStart && !envEnd) {
    const end = addYears(envStart, 1);
    return { from: toYMD(envStart), to: toYMD(end) };
  }
  if (!envStart && envEnd) {
    const start = addYears(envEnd, -1);
    return { from: toYMD(start), to: toYMD(envEnd) };
  }

  // Fallback: Season runs July 1st to July 1st next year
  const now = new Date();
  const year = now.getFullYear();
  const isBeforeJuly = now.getMonth() < 6; // 0-indexed months, 6 = July
  const seasonStart = isBeforeJuly
    ? new Date(year - 1, 6, 1)
    : new Date(year, 6, 1);
  const seasonEnd = isBeforeJuly
    ? new Date(year, 6, 1)
    : new Date(year + 1, 6, 1);
  return { from: toYMD(seasonStart), to: toYMD(seasonEnd) };
}

/**
 * Wall-clock training start times, keyed by `Date.getDay()` weekday number
 * (0=Sun, 3=Wed, 5=Fri). Interpreted in Europe/Amsterdam.
 */
export const TRAINING_START_BY_WEEKDAY: Record<
  number,
  { hour: number; minute: number }
> = {
  3: { hour: 19, minute: 20 },
  5: { hour: 20, minute: 15 },
};

const AMSTERDAM_TZ = "Europe/Amsterdam";

function numberPart(parts: Intl.DateTimeFormatPart[], type: string): number {
  return Number(parts.find((p) => p.type === type)?.value ?? "0");
}

/**
 * Returns calendar and time parts for `d` in Europe/Amsterdam, regardless of
 * the server's timezone. Used to decide whether a same-day training is still
 * joinable.
 */
function amsterdamDateTimeParts(d: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: AMSTERDAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(d);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
    hour: numberPart(parts, "hour"),
    minute: numberPart(parts, "minute"),
  };
}

/**
 * The next *joinable* training date on or after `from`, looking up to 14 days
 * ahead. Returns `null` if none is found (effectively never).
 *
 * Inclusive of `from`'s calendar day, but only if the Amsterdam wall-clock
 * time of `from` is still before that day's training start (Wed 19:20, Fri
 * 20:15). After the start time, the same day is skipped — a "kom je vandaag"
 * nudge would arrive too late.
 */
export function nextTrainingDate(from: Date = new Date()): Date | null {
  const { year, month, day, hour, minute } = amsterdamDateTimeParts(from);
  for (let i = 0; i < 14; i++) {
    const candidate = new Date(year, month - 1, day + i);
    const wd = candidate.getDay();
    const start = TRAINING_START_BY_WEEKDAY[wd];
    if (!start) continue;
    if (i === 0) {
      const past =
        hour > start.hour || (hour === start.hour && minute >= start.minute);
      if (past) continue;
    }
    return candidate;
  }
  return null;
}

const NL_DAY_NAMES = [
  "zondag",
  "maandag",
  "dinsdag",
  "woensdag",
  "donderdag",
  "vrijdag",
  "zaterdag",
];

/**
 * Returns a Dutch day-of-week label for `date`, relative to `today`. Same day
 * → `"vandaag"`, next day → `"morgen"`, day-after → `"overmorgen"`, otherwise
 * the literal weekday name (e.g. `"woensdag"`). Comparison is on the calendar
 * day, ignoring time-of-day.
 */
export function describeRelativeDay(
  date: Date,
  today: Date = new Date(),
): string {
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.round((d1.getTime() - d0.getTime()) / dayMs);
  if (diff === 0) return "vandaag";
  if (diff === 1) return "morgen";
  if (diff === 2) return "overmorgen";
  return NL_DAY_NAMES[date.getDay()];
}

/**
 * Splits training session dates (YYYY-MM-DD) into recent past, older past, and today-or-future
 * for compact trainer UI. Dates are compared as strings on the calendar day.
 *
 * @param datesYmd - Session dates, typically ascending from the API.
 * @param todayYmd - Today's date as YYYY-MM-DD (local calendar for the team).
 * @param recentPastCount - Past sessions to show outside the "earlier" group (default 3).
 */
export function splitTrainingSessionDatesForDisplay(
  datesYmd: string[],
  todayYmd: string,
  recentPastCount = 3,
): { recentPast: string[]; olderPast: string[]; upcoming: string[] } {
  const sorted = datesYmd.slice().sort();
  const past = sorted.filter((d) => d < todayYmd);
  const upcoming = sorted.filter((d) => d >= todayYmd);
  const recentPast =
    past.length <= recentPastCount ? past : past.slice(-recentPastCount);
  const olderPast =
    past.length > recentPastCount
      ? past.slice(0, past.length - recentPastCount)
      : [];
  return { recentPast, olderPast, upcoming };
}
