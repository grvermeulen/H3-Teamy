import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { startPasskeyLogin } from "../../../../../lib/services/passkeyService";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../../../lib/dbUnavailableError";

/**
 * POST — start passkey-login (biometrie / apparaatslot).
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const payload = await startPasskeyLogin(req);
    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    Sentry.captureException(error);
    return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
  }
}
