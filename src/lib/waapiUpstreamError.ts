const WAAPI_AUTH_DETAILS_NL =
  "WaAPI API-token is ongeldig of ingetrokken. Maak een nieuw token in het WaAPI-dashboard en werk WAAPI_API_TOKEN bij in Vercel (Production).";

/**
 * Maps a WaAPI HTTP error to a structured notification failure reason and Dutch admin details.
 *
 * @param status - HTTP status from WaAPI.
 * @param bodyText - Raw response body (may be JSON).
 */
export function classifyWaapiHttpFailure(
  status: number,
  bodyText: string,
): { reason: "api_unauthenticated" | "upstream_error"; details: string } {
  if (status === 401) {
    return { reason: "api_unauthenticated", details: WAAPI_AUTH_DETAILS_NL };
  }

  const trimmed = bodyText.trim();
  if (trimmed) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      if (
        typeof data === "object" &&
        data !== null &&
        "message" in data &&
        typeof (data as { message: unknown }).message === "string"
      ) {
        return {
          reason: "upstream_error",
          details: (data as { message: string }).message,
        };
      }
    } catch {
      // fall through to raw body
    }
    return { reason: "upstream_error", details: trimmed.slice(0, 500) };
  }

  return { reason: "upstream_error", details: `HTTP ${status}` };
}

export { WAAPI_AUTH_DETAILS_NL };
