import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";

function allowed(req: NextRequest): boolean {
  const configured = process.env.ADMIN_MAINT_TOKEN || "";
  // If no token configured, allow (temporary admin endpoint)
  if (!configured) return true;
  const token = req.nextUrl.searchParams.get("token") || req.headers.get("x-admin-token") || "";
  return token === configured;
}

export async function GET(req: NextRequest) {
  if (!allowed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const count = await prisma.user.count({ where: { identities: { none: {} }, rsvps: { none: {} } } });
  return NextResponse.json({ orphans: count });
}

export async function POST(req: NextRequest) {
  if (!allowed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const before = await prisma.user.count({ where: { identities: { none: {} }, rsvps: { none: {} } } });
  const res = await prisma.user.deleteMany({ where: { identities: { none: {} }, rsvps: { none: {} } } });
  const after = await prisma.user.count({ where: { identities: { none: {} }, rsvps: { none: {} } } });
  return NextResponse.json({ before, deleted: res.count, after });
}

