import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getReport, setReport } from "../../../lib/kv";
import { getActiveUser } from "../../../lib/activeUser";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../lib/dbUnavailableError";

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId)
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  const report = await getReport(eventId);
  return NextResponse.json({ report });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const eventId = body?.eventId as string | undefined;
    const content = body?.content as string | undefined;
    if (!eventId || typeof content !== "string")
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    const { userId } = await getActiveUser(req);
    const existing = await getReport(eventId);
    await setReport(eventId, {
      content,
      createdAt: new Date().toISOString(),
      authorId: userId,
      mvpResult: existing?.mvpResult,
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    Sentry.captureException(error);
    return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
  }
}
