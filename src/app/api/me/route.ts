import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getUserProfile, setUserProfile } from "../../../lib/kv";
import { getActiveUser } from "../../../lib/activeUser";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../lib/dbUnavailableError";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getActiveUser(req);
    const profile = await getUserProfile(userId);
    return NextResponse.json({
      user: profile ? { id: userId, ...profile } : null,
    });
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    Sentry.captureException(error);
    return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await getActiveUser(req);
    const { firstName, lastName } = await req.json();
    if (!firstName || !lastName)
      return NextResponse.json(
        { error: "firstName and lastName required" },
        { status: 400 },
      );
    await setUserProfile(userId, { firstName, lastName });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    Sentry.captureException(error);
    return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
  }
}
