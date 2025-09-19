import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db";

function displayName(u: { firstName: string; lastName: string; id: string; email?: string | null }) {
  const full = `${(u.firstName || "").trim()} ${(u.lastName || "").trim()}`.trim();
  if (full) return full;
  const email = (u.email || "").trim();
  if (email) return email;
  return ""; // no display name -> filtered out
}

export async function GET() {
  const users = await prisma.user
    .findMany({ select: { id: true, firstName: true, lastName: true, email: true }, cacheStrategy: { ttl: 300, swr: 300 } as any })
    .catch(() => [] as any[]);
  const seen = new Set<string>();
  const list = [] as { id: string; name: string }[];
  for (const u of users as any[]) {
    const name = displayName(u);
    if (!name) continue; // skip users with no usable name
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // skip duplicates by display name
    seen.add(key);
    list.push({ id: u.id, name });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ users: list });
}
