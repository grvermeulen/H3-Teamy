/**
 * Committed training season window (calendar dates, YYYY-MM-DD).
 * Update each year when the new season starts; also set matching
 * `SEASON_START` / `SEASON_END` (dd-mm-yyyy) in Vercel.
 */
export const CURRENT_SEASON = {
  from: "2026-08-26",
  to: "2027-07-07",
} as const;
