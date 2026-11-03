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
 * Preview deployments often inherit Production `NEXTAUTH_URL`, which breaks CSRF
 * and OAuth redirects. Preview must not pin `VERCEL_URL` either: that unique
 * `*.vercel.app` host differs from the git-branch alias people actually open
 * (`*-git-feat-…`), so credentials login then fails CSRF.
 *
 * @returns Origin without trailing slash, or `undefined` if NextAuth should
 *   infer the URL from the incoming request.
 */
export function resolveNextAuthUrl(): string | undefined {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "preview" || vercelEnv === "development") {
    return undefined;
  }

  const explicit = process.env.NEXTAUTH_URL?.trim();
  if (explicit) {
    return toOrigin(explicit);
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl && process.env.VERCEL === "1") {
    return toOrigin(vercelUrl);
  }

  return undefined;
}

/**
 * Past `process.env.NEXTAUTH_URL` aan vóór NextAuth het leest.
 * Op Vercel preview/development wordt de waarde gewist zodat NextAuth de
 * request-host gebruikt (git-alias vs unieke `VERCEL_URL`).
 */
export function applyNextAuthUrlEnv(): void {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "preview" || vercelEnv === "development") {
    delete process.env.NEXTAUTH_URL;
    return;
  }

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
