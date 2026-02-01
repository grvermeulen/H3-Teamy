import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type { User } from "@prisma/client";
import { prisma } from "../../../lib/db";
import { kvGetJson, kvSetJson } from "../../../lib/kv";
import { displayName } from "../../../lib/userUtils";

type UserRow = Pick<User, "id" | "firstName" | "lastName" | "email">;

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const cacheKey = "users:roster:v2";
  if (!refresh) {
    const cached = await kvGetJson<{ id: string; name: string }[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length) {
      return NextResponse.json({ users: cached });
    }
  }
  let users: UserRow[] = [];
  try {
    users = await prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  } catch (error: unknown) {
    Sentry.captureException(error);
    return NextResponse.json(
      {
        error: "users_query_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
  const seen = new Set<string>();
  const list = [] as { id: string; name: string }[];
  for (const u of users) {
    const name = displayName(u);
    if (!name) continue; // skip users with no usable name
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // dedupe by display name
    seen.add(key);
    list.push({ id: u.id, name });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  await kvSetJson(cacheKey, list);
  return NextResponse.json({ users: list });
}
