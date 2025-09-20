import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/db";
import { kvGetJson, kvSetJson } from "../../../lib/kv";
import { } from "../../../lib/kv";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";
import { } from "next/server";

function displayName(u: { firstName: string; lastName: string; id: string; email?: string | null }) {
  const full = `${(u.firstName || "").trim()} ${(u.lastName || "").trim()}`.trim();
  if (full) return full;
  const email = (u.email || "").trim();
  if (email) return email;
  return ""; // revert: exclude users without a usable display name
}

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const cacheKey = "users:roster:v1";
  if (!refresh) {
    const cached = await kvGetJson<{ id: string; name: string }[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length) {
      return NextResponse.json({ users: cached });
    }
  }
  let users: any[] = [];
  try {
    users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, email: true } });
  } catch (e: any) {
    return NextResponse.json({ error: "users_query_failed", message: e?.message || String(e) }, { status: 500 });
  }
  const seen = new Set<string>();
  const list = [] as { id: string; name: string }[];
  for (const u of users as any[]) {
    const name = displayName(u);
    if (!name) continue; // skip users with no usable name (root cause of empty lists if everyone has blank profile)
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // dedupe by display name
    seen.add(key);
    list.push({ id: u.id, name });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  await kvSetJson(cacheKey, list);
  return NextResponse.json({ users: list });
}
