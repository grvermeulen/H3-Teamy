/**
 * Dutch datetime formatters using Europe/Amsterdam, including daylight saving,
 * so match times and dates remain consistent across devices and server timezones.
 */

const DATE_LOCALE = "nl-NL";
const TIME_ZONE = "Europe/Amsterdam";

const dateFmt = new Intl.DateTimeFormat(DATE_LOCALE, {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "short",
});

const timeFmt = new Intl.DateTimeFormat(DATE_LOCALE, {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

const longDateFmt = new Intl.DateTimeFormat(DATE_LOCALE, {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const dateTimeFmt = new Intl.DateTimeFormat(DATE_LOCALE, {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Short event date: `wo 24 dec`. */
export function formatEventDate(d: Date | string | number): string {
  return dateFmt.format(typeof d === "object" ? d : new Date(d));
}

/** Range of times in 24h Dutch notation, falling back to a single time. */
export function formatEventTime(
  start: Date | string | number,
  end?: Date | string | number | null,
): string {
  const s = typeof start === "object" ? start : new Date(start);
  const startStr = timeFmt.format(s);
  if (!end) return startStr;
  const e = typeof end === "object" ? end : new Date(end);
  return `${startStr} – ${timeFmt.format(e)}`;
}

/** Long, human form: `woensdag 24 december`. */
export function formatLongDate(d: Date | string | number): string {
  return longDateFmt.format(typeof d === "object" ? d : new Date(d));
}

/** Compact mixed datetime: `24-12-2026 19:30`. */
export function formatDateTime(d: Date | string | number): string {
  return dateTimeFmt.format(typeof d === "object" ? d : new Date(d));
}
