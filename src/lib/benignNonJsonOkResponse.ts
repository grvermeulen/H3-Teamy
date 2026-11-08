/** Message thrown by {@link safeClientJson} when a 2xx body cannot be parsed as JSON. */
export const NON_JSON_OK_RESPONSE_SYNTAX_MESSAGE =
  "Response body is not valid JSON";

/**
 * Returns whether a successful HTTP response body is expected edge/infrastructure
 * output rather than a broken JSON API (empty body, HTML error pages, Vercel edge
 * plain-text `Error NNN:` lines, deployment-not-found pages).
 *
 * @param bodyText - Raw response body text (may be empty).
 */
export function isBenignNonJsonOkResponseBody(bodyText: string): boolean {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return true;
  }
  const probe = trimmed.slice(0, 512).toLowerCase();
  if (probe.startsWith("<!doctype") || probe.startsWith("<html")) {
    return true;
  }
  if (/^error\s+\d{3}:/i.test(trimmed)) {
    return true;
  }
  if (trimmed.includes("DEPLOYMENT_NOT_FOUND")) {
    return true;
  }
  if (trimmed.includes("The deployment could not be found on Vercel.")) {
    return true;
  }
  return false;
}

/**
 * Returns whether a `Content-Type` on a nominally successful response indicates
 * non-JSON infrastructure output (HTML/XML), which should not be reported as an
 * app regression when JSON parsing fails.
 *
 * @param contentType - Value of the `Content-Type` response header, if any.
 */
export function isBenignNonJsonOkResponseContentType(
  contentType: string | null,
): boolean {
  if (!contentType) {
    return false;
  }
  const lower = contentType.toLowerCase();
  return (
    lower.includes("text/html") ||
    lower.includes("application/xhtml") ||
    lower.includes("text/xml")
  );
}
