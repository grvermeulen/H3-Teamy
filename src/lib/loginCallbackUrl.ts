/**
 * Normaliseert en valideert `callbackUrl` uit de querystring voor na-login redirects.
 * Alleen relatieve paden die met één `/` beginnen zijn toegestaan (geen `//` protocol-relative URLs).
 * @param value - Ruwe waarde uit `searchParams.callbackUrl` (of `undefined`).
 * @returns Veilig relatief pad, standaard `"/"`.
 */
export function getSafeCallbackUrl(value: string | undefined): string {
  if (value == null) return "/";
  const trimmed = value.trim();
  if (trimmed === "") return "/";
  if (!trimmed.startsWith("/")) return "/";
  if (trimmed.startsWith("//")) return "/";
  if (/^\/[a-zA-Z][a-zA-Z+.-]*:/i.test(trimmed)) return "/";
  return trimmed;
}
