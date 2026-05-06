import type { NextRequest } from "next/server";
import { getWebAuthnAllowedOrigins } from "./webAuthnEnv";

/**
 * Bepaalt welke `expectedOrigin`-waarden SimpleWebAuthn mag accepteren voor dit verzoek.
 * Prefereert geconfigureerde origins; valt terug op de `Origin`-header als er niets geconfigureerd is (lokaal).
 *
 * @param req - Inkomend API-verzoek met optionele `Origin`-header.
 */
export function resolveWebAuthnExpectedOrigins(req: NextRequest): string[] {
  const allowed = getWebAuthnAllowedOrigins();
  const origin = req.headers.get("origin");
  if (origin && allowed.includes(origin)) {
    return allowed;
  }
  if (allowed.length > 0) {
    return allowed;
  }
  return origin ? [origin] : [];
}
