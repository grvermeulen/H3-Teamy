function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
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
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const slug = slugifyTitle(title);
  return `${y}${m}${day}--${slug}`;
}
