/**
 * Splits chronologically sorted events (by `start`) into recent past, older past, and future
 * relative to `nowMs`. Used to collapse long past lists behind a disclosure.
 *
 * @param items - Events with ISO `start`; order is normalized ascending by start time.
 * @param nowMs - Current time in milliseconds (e.g. `Date.now()`).
 * @param recentPastCount - How many past items stay visible (the last N before `nowMs`).
 * @returns `recentPast` and `olderPast` in chronological order (oldest first); `future` chronological.
 */
export function splitPastAndFutureByStart<T extends { start: string }>(
  items: T[],
  nowMs: number,
  recentPastCount: number,
): { recentPast: T[]; olderPast: T[]; future: T[] } {
  const allSorted = items
    .slice()
    .sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
  const idx = allSorted.findIndex((e) => new Date(e.start).getTime() >= nowMs);
  const pastAll = idx === -1 ? allSorted : allSorted.slice(0, idx);
  const future = idx === -1 ? [] : allSorted.slice(idx);
  const recentPast =
    pastAll.length <= recentPastCount
      ? pastAll
      : pastAll.slice(-recentPastCount);
  const olderPast =
    pastAll.length > recentPastCount
      ? pastAll.slice(0, pastAll.length - recentPastCount)
      : [];
  return { recentPast, olderPast, future };
}
