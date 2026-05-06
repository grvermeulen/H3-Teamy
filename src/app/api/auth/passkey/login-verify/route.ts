import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../../../lib/dbUnavailableError";
import { createPasskeyExchangeToken } from "../../../../../lib/passkeyExchangeToken";
import { finishPasskeyLogin } from "../../../../../lib/services/passkeyService";
import { resolveWebAuthnExpectedOrigins } from "../../../../../lib/webAuthnRequest";

const bodySchema = z.object({
  loginSessionId: z.string().min(1),
  credential: z.record(z.string(), z.unknown()),
});

/**
 * POST — verifieert passkey-login en geeft een kortlevend token voor NextAuth credentials.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
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
      .credential as unknown as AuthenticationResponseJSON;
    const result = await finishPasskeyLogin(
      credential,
      parsed.data.loginSessionId,
      origins,
    );
    if ("error" in result) {
      const map: Record<string, string> = {
        challenge_missing:
          "Sessie verlopen. Vraag opnieuw een passkey-aanmelding aan.",
        credential_unknown: "Geen bekende passkey. Voeg eerder een passkey toe op je profiel.",
        verification_failed: "Passkey kon niet worden geverifieerd.",
      };
      return NextResponse.json(
        { error: map[result.error] ?? "Inloggen met passkey mislukt." },
        { status: 400 },
      );
    }
    const exchangeToken = createPasskeyExchangeToken(result.userId);
    if (!exchangeToken) {
      return NextResponse.json(
        { error: "Serverconfiguratie ontbreekt (NEXTAUTH_SECRET)." },
        { status: 500 },
      );
    }
    return NextResponse.json({ exchangeToken });
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    Sentry.captureException(error);
    return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
  }
}
