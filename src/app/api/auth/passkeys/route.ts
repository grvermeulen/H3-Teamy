import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getActiveUser } from "../../../../lib/activeUser";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../../lib/dbUnavailableError";
import {
  deletePasskeyForUser,
  listPasskeysForUser,
} from "../../../../lib/services/passkeyService";

/**
 * GET — lijst passkeys voor het actieve account (profiel).
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const { userId } = await getActiveUser(req);
    const passkeys = await listPasskeysForUser(userId);
    return NextResponse.json({
      passkeys: passkeys.map((p) => ({
        id: p.id,
        createdAt: p.createdAt.toISOString(),
        label: p.label,
      })),
    });
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    Sentry.captureException(error);
    return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
  }
}

/**
 * DELETE — verwijdert een passkey (`?id=`).
 */
export async function DELETE(req: NextRequest): Promise<Response> {
  try {
    const { userId } = await getActiveUser(req);
    const id = req.nextUrl.searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ error: "Ontbrekende id" }, { status: 400 });
    }
    const removed = await deletePasskeyForUser(userId, id);
    if (!removed) {
      return NextResponse.json({ error: "Passkey niet gevonden" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    Sentry.captureException(error);
    return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
  }
}
