import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getActiveUsers } from "@/lib/services/userService";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "@/lib/dbUnavailableError";
import { shouldCaptureApiRouteException } from "@/lib/sentryApiRouteCapture";

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  try {
    const users = await getActiveUsers(refresh);
    return NextResponse.json({ users });
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    if (shouldCaptureApiRouteException(error)) {
      Sentry.captureException(error);
    }
    return NextResponse.json(
      { error: "Er ging iets mis bij het ophalen van gebruikers." },
      { status: 500 },
    );
  }
}
