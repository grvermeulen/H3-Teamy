export type AttendanceBadge = {
  slug: "rookie" | "average" | "veteran" | "furniture";
  label: string;
};

export function getBadgeForAttendance(percent: number): AttendanceBadge {
  const clamped = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  if (clamped < 40) return { slug: "rookie", label: "Rookie" }; // 0–39%
  if (clamped < 60) return { slug: "average", label: "Average Jo" }; // 40–59%
  if (clamped < 80) return { slug: "veteran", label: "Veteran" }; // 60–79%
  return { slug: "furniture", label: "Part of the furniture" }; // 80–100%
}
