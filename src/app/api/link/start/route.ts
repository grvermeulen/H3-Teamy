import { NextRequest, NextResponse } from "next/server";
import { createLinkCode } from "../../../../lib/kv";

function getUserId(req: NextRequest): string | null {
  return req.cookies.get("anon_id")?.value || null;
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const code = await createLinkCode(userId);
  return NextResponse.json({ code });
}


