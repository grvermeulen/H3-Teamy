export type AttendanceBadge = {
  slug: "none" | "rookie" | "average" | "veteran" | "furniture";
  label: string;
};

export function getBadgeForAttendance(percent: number): AttendanceBadge {
  const clamped = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  if (clamped < 20) return { slug: "none", label: "No badge" };
  if (clamped < 40) return { slug: "rookie", label: "Rookie" };
  if (clamped < 60) return { slug: "average", label: "Average Jo" };
  if (clamped < 80) return { slug: "veteran", label: "Veteran" };
  return { slug: "furniture", label: "Part of the furniture" };
}
