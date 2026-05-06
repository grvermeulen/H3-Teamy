import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getActiveUser } from "../../../../../lib/activeUser";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../../../lib/dbUnavailableError";
import { startPasskeyRegistration } from "../../../../../lib/services/passkeyService";

/**
 * POST — start WebAuthn-passkey registratie; gebruiker moet ingelogd zijn.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { userId } = await getActiveUser(req);
    let payload;
    try {
      payload = await startPasskeyRegistration(userId, req);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "user_not_found") {
        return NextResponse.json(
          { error: "Gebruiker niet gevonden" },
          { status: 404 },
        );
      }
      if (error instanceof Error && error.message === "user_id_too_long") {
        return NextResponse.json(
          { error: "Account-id niet compatibel met passkeys." },
          { status: 400 },
        );
      }
      throw error;
    }
    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    Sentry.captureException(error);
    return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
  }
}
