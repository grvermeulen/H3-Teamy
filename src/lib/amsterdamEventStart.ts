import { TZDateMini } from "@date-fns/tz";

/** Wall-clock date/time in Europe/Amsterdam, converted to ISO UTC (Sportlink/KNZB style). */
export type AmsterdamWallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/**
 * Converts an Amsterdam wall-clock start into an ISO string for `TeamEvent.start`.
 *
 * @param parts - Calendar fields in Europe/Amsterdam (month 1–12).
 */
export function amsterdamWallClockToIso(parts: AmsterdamWallClock): string {
  const { year, month, day, hour, minute } = parts;
  return new TZDateMini(
    year,
    month - 1,
    day,
    hour,
    minute,
    0,
    0,
    "Europe/Amsterdam",
  ).toISOString();
}
