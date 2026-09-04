import type { NextRequest } from "next/server";
import { resolveNextAuthUrl } from "./nextAuthUrl";

export type WebAuthnRpConfig = {
  rpID: string;
  rpName: string;
};

/**
 * Bepaalt RP-ID voor WebAuthn op basis van dit HTTP-verzoek (aanbevolen).
 * Gebruikt `WEBAUTHN_RP_ID` als die gezet is; anders de hostname uit
 * `x-forwarded-host` / `host` zodat preview en 127.0.0.1 overeenkomen met de site in de browser.
 * Valt terug op {@link getWebAuthnRpConfig} zonder Host-header (tests/batch).
 *
 * @param req - Inkomend API-verzoek (App Router route handler).
 */
export function resolveWebAuthnRpConfig(req: NextRequest): WebAuthnRpConfig {
  const rpName = process.env.WEBAUTHN_RP_NAME ?? "H3 Teamy";
  const explicit = process.env.WEBAUTHN_RP_ID?.trim();
  if (explicit) {
    return { rpID: explicit, rpName };
  }
  const forwarded = req.headers.get("x-forwarded-host");
  const hostHeader = req.headers.get("host");
  const raw = forwarded ?? hostHeader;
  if (raw) {
    const hostname = raw.split(":")[0]?.trim();
    if (hostname) {
      return { rpID: hostname, rpName };
    }
  }
  return getWebAuthnRpConfig();
}

/**
 * Fallback RP-configuratie zonder inkomend verzoek (tests, batch, scripts).
 * `WEBAUTHN_RP_ID` heeft voorrang; anders hostname van `NEXTAUTH_URL` / `VERCEL_URL`, anders `localhost`
 * (niet aanbevolen voor productie).
 *
 * @returns Configuratie voor SimpleWebAuthn `rpID` / `rpName`.
 */
export function getWebAuthnRpConfig(): WebAuthnRpConfig {
  const rpName = process.env.WEBAUTHN_RP_NAME ?? "H3 Teamy";
  const explicit = process.env.WEBAUTHN_RP_ID?.trim();
  if (explicit) {
    return { rpID: explicit, rpName };
  }
  const resolved = resolveNextAuthUrl();
  if (resolved) {
    try {
      const host = new URL(resolved).hostname;
      if (host) return { rpID: host, rpName };
    } catch {
      /* fall through */
    }
  }
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    try {
      const host = new URL(
        vercel.startsWith("http") ? vercel : `https://${vercel}`,
      ).hostname;
      if (host) return { rpID: host, rpName };
    } catch {
      /* fall through */
    }
  }
  return { rpID: "localhost", rpName };
}

/**
 * Toegestane `Origin`-waarden voor WebAuthn-verificatie (clientDataJSON.origin).
 * Combineert `NEXTAUTH_URL`, optioneel `WEBAUTHN_ALLOWED_ORIGINS` (komma-gescheiden volledige origins).
 *
 * @returns Lijst unieke origin-strings inclusief protocol en poort.
 */
export function getWebAuthnAllowedOrigins(): string[] {
  const out = new Set<string>();
  const resolved = resolveNextAuthUrl();
  if (resolved) {
    try {
      out.add(new URL(resolved).origin);
    } catch {
      /* skip */
    }
  }
  const extra = process.env.WEBAUTHN_ALLOWED_ORIGINS;
  if (extra) {
    for (const part of extra.split(",")) {
      const o = part.trim();
      if (o) out.add(o);
    }
  }
  return [...out];
}
