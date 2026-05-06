import type { RegistrationResponseJSON } from "@simplewebauthn/browser";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { getActiveUser } from "../../../../../lib/activeUser";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../../../lib/dbUnavailableError";
import { finishPasskeyRegistration } from "../../../../../lib/services/passkeyService";
import { resolveWebAuthnExpectedOrigins } from "../../../../../lib/webAuthnRequest";

const bodySchema = z.object({
  credential: z.record(z.string(), z.unknown()),
});

/**
 * POST — voltooit WebAuthn-passkey registratie (`startRegistration`-response).
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { userId } = await getActiveUser(req);
    const json: unknown = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ongeldige invoer", details: parsed.error.issues },
        { status: 400 },
      );
    }
    const origins = resolveWebAuthnExpectedOrigins(req);
    const credential = parsed.data
      .credential as unknown as RegistrationResponseJSON;
    const result = await finishPasskeyRegistration(userId, credential, origins);
    if (!result.ok) {
      const map: Record<string, string> = {
        challenge_missing:
          "Sessie verlopen. Probeer opnieuw een passkey toe te voegen.",
        verification_failed: "Passkey kon niet worden geverifieerd.",
        duplicate_or_db:
          "Deze passkey is al geregistreerd of opslaan is mislukt.",
      };
      return NextResponse.json(
        { error: map[result.error] ?? "Passkey registreren mislukt." },
        { status: 400 },
      );
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
