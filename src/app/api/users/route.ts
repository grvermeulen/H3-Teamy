import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db";

function displayName(u: { firstName: string; lastName: string; id: string; email?: string | null }) {
  const full = `${(u.firstName || "").trim()} ${(u.lastName || "").trim()}`.trim();
  if (full) return full;
  const email = (u.email || "").trim();
  if (email) return email;
  return `User ${u.id.slice(0, 6)}`; // fallback so roster is never empty
}

export async function GET() {
  const users = await (prisma as any).user
    .findMany({ select: { id: true, firstName: true, lastName: true, email: true }, cacheStrategy: { ttl: 300, swr: 300 } })
    .catch(() => [] as any[]);
  const seenIds = new Set<string>();
  const list = [] as { id: string; name: string }[];
  for (const u of users as any[]) {
    if (seenIds.has(u.id)) continue; // dedupe by id only
    seenIds.add(u.id);
    const name = displayName(u);
    list.push({ id: u.id, name });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ users: list });
}
