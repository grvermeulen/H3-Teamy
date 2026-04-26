/**
 * Performs `fetch` with a per-attempt timeout and limited retries for transient
 * network failures (timeouts, connection drops). Intended for third-party feeds
 * (e.g. Sportlink iCal) where a single long-hanging attempt hurts serverless latency.
 *
 * @param url - Request URL.
 * @param init - Optional `fetch` init; `timeoutMs` and `maxAttempts` are consumed here and not passed to `fetch`.
 * @param init.timeoutMs - Abort each attempt after this many milliseconds (default 10000).
 * @param init.maxAttempts - Maximum number of attempts including the first (default 3).
 * @returns The `Response` from the first successful attempt.
 * @throws The last error if all attempts fail.
 */
export async function fetchWithTimeoutAndRetries(
  url: string,
  init: RequestInit & { timeoutMs?: number; maxAttempts?: number } = {},
): Promise<Response> {
  const { timeoutMs = 10_000, maxAttempts = 3, ...fetchInit } = init;
  const attempts = Math.max(1, Math.floor(maxAttempts));

  let lastError: Error = new Error("Geen fetch-poging uitgevoerd");

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetch(url, {
        ...fetchInit,
        signal: AbortSignal.any([
          ...(fetchInit.signal ? [fetchInit.signal] : []),
          AbortSignal.timeout(timeoutMs),
        ]),
      });
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < attempts - 1) {
        await new Promise((r) =>
          setTimeout(r, Math.pow(2, attempt) * 500),
        );
      }
    }
  }

  throw lastError;
}
