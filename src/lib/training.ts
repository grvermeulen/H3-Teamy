export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const now = new Date();
  const to = new Date(2026, 6, 1); // 2026-07-01
  return { from: toYMD(now), to: toYMD(to) };
}



