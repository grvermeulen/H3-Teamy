import * as Sentry from "@sentry/nextjs";

/**
 * Normalizes a host or URL string to an origin (no trailing slash).
 * Alleen `http:` en `https:` zijn toegestaan (geen `httpx:` of andere schema’s).
 *
 * @param value - Hostname of volledige URL.
 * @returns Geparsede origin, of `undefined` bij ongeldige invoer.
 */
function toOrigin(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const hasHttpOrHttps = /^(https?):\/\//i.test(trimmed);
  const withScheme = hasHttpOrHttps ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    const origin = parsed.origin;
    if (origin === "null") return undefined;
    return origin;
  } catch (error: unknown) {
    Sentry.captureException(error, {
      extra: { context: "nextauth_url_toOrigin", input: value },
    });
    return undefined;
  }
}

/**
 * Resolves the canonical site URL for NextAuth on Vercel.
 * Preview deployments often inherit Production `NEXTAUTH_URL`, which breaks CSRF and OAuth redirects.
 *
 * @returns Origin without trailing slash, or `undefined` if nothing to apply.
 */
export function resolveNextAuthUrl(): string | undefined {
  const vercelEnv = process.env.VERCEL_ENV;
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl && (vercelEnv === "preview" || vercelEnv === "development")) {
    return toOrigin(vercelUrl);
  }

  const explicit = process.env.NEXTAUTH_URL?.trim();
  if (explicit) {
    return toOrigin(explicit);
  }

  if (vercelUrl && process.env.VERCEL === "1") {
    return toOrigin(vercelUrl);
  }

  return undefined;
}

/**
 * Past `process.env.NEXTAUTH_URL` aan vóór NextAuth het leest.
 * Zet een geldige origin indien beschikbaar; verwijdert ongeldige of lege waarden
 * zodat NextAuth de request-URL als fallback kan gebruiken.
 */
export function applyNextAuthUrlEnv(): void {
  const resolved = resolveNextAuthUrl();
  if (resolved) {
    process.env.NEXTAUTH_URL = resolved;
    return;
  }

  const raw = process.env.NEXTAUTH_URL;
  if (raw === undefined) return;

  const trimmed = raw.trim();
  if (!trimmed || toOrigin(trimmed) === undefined) {
    delete process.env.NEXTAUTH_URL;
  }
}
