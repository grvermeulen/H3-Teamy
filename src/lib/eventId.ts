const amsterdamYmdPartsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar YYYY/MM/DD in Europe/Amsterdam for match ids (wall-clock match day). */
function amsterdamCalendarParts(d: Date): {
  y: string;
  m: string;
  day: string;
} {
  const parts = amsterdamYmdPartsFmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return { y, m, day };
}

/**
 * Slugifies a title string for use in URLs or IDs.
 * Converts to lowercase, normalizes accents, and replaces non-alphanumeric chars with dashes.
 *
 * @param title - The title to slugify.
 * @returns The slugified string.
 */
export function slugifyTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // Remove combining diacritical marks
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Generates a canonical event ID based on the event title and start date.
 * Format: YYYYMMDD--slugified-title
 *
 * @param title - The title of the event.
 * @param start - The start date of the event (Date object or string).
 * @returns A unique canonical ID string.
 */
export function canonicalEventId(title: string, start: Date | string): string {
  const d = start instanceof Date ? start : new Date(start);
  const { y, m, day } = amsterdamCalendarParts(d);
  const slug = slugifyTitle(title);
  return `${y}${m}${day}--${slug}`;
}
