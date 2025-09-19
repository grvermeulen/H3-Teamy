import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db";

function displayName(u: { firstName: string; lastName: string; id: string; email?: string | null }) {
  const full = `${(u.firstName || "").trim()} ${(u.lastName || "").trim()}`.trim();
  if (full) return full;
  const email = (u.email || "").trim();
  if (email) return email;
  return `User ${u.id.slice(0, 6)}`;
}

export async function GET() {
  const users = await prisma.user
    .findMany({ select: { id: true, firstName: true, lastName: true, email: true } })
    .catch(() => [] as any[]);
  const list = users
    .map((u: any) => ({ id: u.id, name: displayName(u) }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
  return NextResponse.json({ users: list });
}
