function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function slugifyTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function canonicalEventId(title: string, start: Date | string): string {
  const d = start instanceof Date ? start : new Date(start);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const slug = slugifyTitle(title);
  return `${y}${m}${day}--${slug}`;
}


