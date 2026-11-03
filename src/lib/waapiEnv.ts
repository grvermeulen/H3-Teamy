import { z } from "zod";

/**
 * Strips accidental `Bearer` prefix or wrapping quotes from a WaAPI token copied from dashboards or docs.
 *
 * @param raw - Value from `WAAPI_API_TOKEN`.
 * @returns Token suitable for `Authorization: Bearer …`.
 */
export function normalizeWaapiApiToken(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (/^Bearer\s+/i.test(value)) {
    value = value.replace(/^Bearer\s+/i, "").trim();
  }
  return value;
}

const WaapiEnvSchema = z.object({
  WAAPI_BASE_URL: z.string().trim().url().default("https://waapi.app/api/v1"),
  WAAPI_INSTANCE_ID: z.string().trim().min(1),
  WAAPI_API_TOKEN: z.string().trim().min(1),
  WAAPI_GROUP_CHAT_ID: z.string().trim().min(1),
  APP_URL: z.string().trim().url(),
});

export type WaapiRuntimeConfig = {
  baseUrl: string;
  instanceId: string;
  apiToken: string;
  groupChatId: string;
  appUrl: string;
};

/**
 * Loads WaAPI env vars when notifications are enabled and all required values are present.
 *
 * @returns Parsed config or `null` when validation fails.
 */
export function loadWaapiRuntimeConfig(): WaapiRuntimeConfig | null {
  const parsed = WaapiEnvSchema.safeParse(process.env);
  if (!parsed.success) return null;
  const env = parsed.data;

  return {
    baseUrl: env.WAAPI_BASE_URL.replace(/\/$/, ""),
    instanceId: env.WAAPI_INSTANCE_ID,
    apiToken: normalizeWaapiApiToken(env.WAAPI_API_TOKEN),
    groupChatId: env.WAAPI_GROUP_CHAT_ID.trim(),
    appUrl: env.APP_URL.replace(/\/$/, ""),
  };
}

/**
 * Headers required by the WaAPI REST API for JSON requests.
 *
 * @param apiToken - Normalized bearer token (without the `Bearer` prefix).
 */
export function buildWaapiJsonHeaders(
  apiToken: string,
): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiToken}`,
  };
}
