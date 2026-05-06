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
 * The next training date on or after `from`, looking up to 14 days ahead.
 * Returns `null` if no Wed/Fri falls in that window (effectively never, but
 * callers should still handle it).
 *
 * Inclusive of `from` itself: if `from` is a Wed or Fri, that same day is the
 * answer. The bucket logic upstream already excludes mid-range users, so an
 * encourage-bucket player on a training-day morning gets a "vandaag" nudge,
 * which is the desired behavior.
 */
export function nextTrainingDate(from: Date = new Date()): Date | null {
  for (let i = 0; i < 14; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const wd = d.getDay();
    if (wd === 3 || wd === 5) return d;
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
