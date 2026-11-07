/**
 * Splits chronologically sorted events (by `start`) into recent past, older past, and future
 * relative to `nowMs`. Used to collapse long past lists behind a disclosure.
 *
 * @param items - Events with ISO `start`; order is normalized ascending by start time.
 * @param nowMs - Current time in milliseconds (e.g. `Date.now()`).
 * @param recentPastCount - How many past items stay visible (the last N before `nowMs`).
 * @returns `recentPast` and `olderPast` in chronological order (oldest first); `future` chronological.
 */
function eventEndMs(end: string | undefined): number | null {
  if (!end) return null;
  const t = new Date(end).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Match still in progress at `nowMs` (started but not ended). */
export function isMatchInProgressAt<T extends { start: string; end?: string }>(
  event: T,
  nowMs: number,
): boolean {
  const startMs = new Date(event.start).getTime();
  const endMs = eventEndMs(event.end);
  return startMs < nowMs && endMs !== null && endMs >= nowMs;
}

export function splitPastAndFutureByStart<
  T extends { start: string; end?: string },
>(
  items: T[],
  nowMs: number,
  recentPastCount: number,
): { recentPast: T[]; olderPast: T[]; future: T[] } {
  const allSorted = items
    .slice()
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const idx = allSorted.findIndex((e) => new Date(e.start).getTime() >= nowMs);
  const pastAll = idx === -1 ? allSorted : allSorted.slice(0, idx);
  const future = idx === -1 ? [] : allSorted.slice(idx);
  const defaultRecent =
    pastAll.length <= recentPastCount
      ? pastAll
      : pastAll.slice(-recentPastCount);
  const livePast = pastAll.filter((e) => isMatchInProgressAt(e, nowMs));
  const pinnedIds = new Set<string | number>();
  const recentPast: T[] = [];
  for (const e of [...livePast, ...defaultRecent]) {
    const key = (e as { id?: string }).id ?? e.start;
    if (pinnedIds.has(key)) continue;
    pinnedIds.add(key);
    recentPast.push(e);
  }
  recentPast.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  const olderPast = pastAll.filter((e) => {
    const key = (e as { id?: string }).id ?? e.start;
    return !pinnedIds.has(key);
  });
  return { recentPast, olderPast, future };
}
