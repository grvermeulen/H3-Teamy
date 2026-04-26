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
