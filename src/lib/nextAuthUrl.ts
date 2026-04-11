/**
 * Normalizes a host or URL string to an origin (no trailing slash).
 *
 * @param value - Hostname or full URL.
 * @returns Parsed origin, or `undefined` if invalid.
 */
function toOrigin(value: string): string | undefined {
  const withScheme = value.startsWith("http") ? value : `https://${value}`;
  try {
    return new URL(withScheme).origin;
  } catch {
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
