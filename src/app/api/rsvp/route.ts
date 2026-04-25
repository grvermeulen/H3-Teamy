import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getRsvp, setRsvp } from "../../../lib/kv";
import { getActiveUser } from "../../../lib/activeUser";
import { prisma } from "../../../lib/db";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../lib/dbUnavailableError";

export async function GET(req: NextRequest) {
  try {
    const eventId = req.nextUrl.searchParams.get("eventId");
    if (!eventId)
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    const { userId } = await getActiveUser(req);
    const status = await getRsvp(userId, eventId);
    return NextResponse.json({ status });
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    Sentry.captureException(error);
    return NextResponse.json({ status: null });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const eventId = body?.eventId as string | undefined;
    const status = body?.status as "yes" | "no" | "maybe" | null | undefined;
    if (!eventId)
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    if (
      status !== "yes" &&
      status !== "no" &&
      status !== "maybe" &&
      status !== null
    ) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    const { userId } = await getActiveUser(req);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const first = (user?.firstName || "").trim();
    const last = (user?.lastName || "").trim();
    if (!first || !last) {
      return NextResponse.json(
        {
          error: "profile_incomplete",
          message:
            "Vul eerst je voor- en achternaam in voordat je een reactie geeft.",
        },
        { status: 412 },
      );
    }
    await setRsvp(userId, eventId, status ?? null);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    Sentry.captureException(error);
    return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
  }
}
