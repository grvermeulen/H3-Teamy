import { extractApiCostUsd } from "./pricing";
import type { JevResponse } from "./types";

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export interface JevClientOptions {
  apiKey: string;
  maxRetries?: number;
  fetchFn?: typeof fetch;
}

/**
 * Calls the JEV systemone API with exponential backoff on 429/529.
 * @param body - Request JSON body (state + model + questions).
 * @param options - API key and optional retry settings.
 */
export async function callJevApi(
  body: unknown,
  options: JevClientOptions,
): Promise<JevResponse> {
  const fetchFn = options.fetchFn ?? fetch;
  const maxRetries = options.maxRetries ?? 4;
  let delayMs = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetchFn(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const json = await res.json();
      return parseJevResponse(json);
    }

    if ((res.status === 429 || res.status === 529) && attempt < maxRetries) {
      await sleep(delayMs);
      delayMs *= 2;
      continue;
    }

    const text = await res.text();
    throw new JevApiError(res.status, text.slice(0, 500));
  }

  throw new Error("JEV API retries exhausted");
}

/** Error thrown when the JEV API returns a non-retryable HTTP status. */
export class JevApiError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`JEV API ${status}: ${body}`);
    this.name = "JevApiError";
  }
}

/**
 * Returns true when the API rejected the request for exceeding token limits.
 * @param error - Caught error from callJevApi.
 */
export function isMaxTokensExceededError(error: unknown): boolean {
  return (
    error instanceof JevApiError &&
    error.status === 400 &&
    error.message.includes("max_tokens_exceeded")
  );
}

/**
 * Parses and validates a JEV API response payload.
 * @param json - Raw parsed JSON from the API.
 */
export function parseJevResponse(json: unknown): JevResponse {
  if (!json || typeof json !== "object") {
    throw new Error("Invalid JEV response: not an object");
  }
  const record = json as Record<string, unknown>;
  if (typeof record.model !== "string") {
    throw new Error("Invalid JEV response: missing model");
  }
  if (!record.answers || typeof record.answers !== "object") {
    throw new Error("Invalid JEV response: missing answers");
  }
  const usage = record.usage as Record<string, unknown> | undefined;
  if (
    !usage ||
    typeof usage.input_tokens !== "number" ||
    typeof usage.output_tokens !== "number"
  ) {
    throw new Error("Invalid JEV response: missing usage");
  }

  const response = json as JevResponse;
  const apiCost = extractApiCostUsd(json);
  if (apiCost !== undefined) {
    response.usage = { ...response.usage, cost_usd: apiCost };
  }
  return response;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
