/**
 * Vercel AI Gateway model ids for H3-Teamy. Premium snapshots (Opus, Sonnet 4,
 * GPT-5 chat) return 403 "Free tier users do not have access to this model" on
 * teams without paid AI Gateway credits — see Sentry JAVASCRIPT-NEXTJS-1S and
 * JAVASCRIPT-NEXTJS-38.
 */

/** `generateObject` default (idea triage, attendance nudges). */
export const DEFAULT_STRUCTURED_GATEWAY_MODEL = "openai/gpt-4o";

/** `generateText` default (match report narrative). */
export const DEFAULT_TEXT_GATEWAY_MODEL = "openai/gpt-4o";

/** Screenshot extraction default: strongest current OpenAI vision model. */
export const DEFAULT_REPORT_EXTRACT_GATEWAY_MODEL = "openai/gpt-5.6-sol";

const STRUCTURED_FALLBACK = DEFAULT_STRUCTURED_GATEWAY_MODEL;
const TEXT_FALLBACK = DEFAULT_TEXT_GATEWAY_MODEL;

/** Model id suffixes blocked on AI Gateway free tier (provider prefix stripped). */
const FREE_TIER_BLOCKED_IDS = new Set([
  "claude-opus-4",
  "claude-sonnet-4",
  "gpt-5-chat-latest",
  "gpt-5.2-2025-12-11",
]);

/**
 * Maps bare env model ids to canonical AI Gateway ids (without provider prefix).
 * Vercel env often uses hyphenated snapshots (e.g. `claude-sonnet-4-6`) while the
 * gateway registers dotted versions (`claude-sonnet-4.6`) — see Sentry
 * JAVASCRIPT-NEXTJS-3E.
 */
const GATEWAY_MODEL_ID_ALIASES: Record<string, string> = {
  "claude-sonnet-4-6": "claude-sonnet-4.6",
};

export type GatewayModelKind = "structured" | "text";

export type ResolvedGatewayModel = {
  /** Full `provider/model` string for the AI SDK. */
  model: string;
  /** Set when a blocked or legacy id was rewritten to a supported default. */
  substitutedFrom?: string;
};

/**
 * Strips a leading `provider/` prefix for comparisons only.
 */
export function gatewayModelId(model: string): string {
  const trimmed = model.trim();
  const slash = trimmed.indexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/**
 * Normalizes a bare model id to the canonical AI Gateway id (no provider prefix).
 */
export function normalizeGatewayModelId(modelId: string): string {
  const id = gatewayModelId(modelId);
  return GATEWAY_MODEL_ID_ALIASES[id] ?? id;
}

/**
 * Infers the AI Gateway provider from a bare model id.
 */
export function inferGatewayProvider(modelId: string): "anthropic" | "openai" {
  const id = normalizeGatewayModelId(modelId);
  if (id.startsWith("claude-")) return "anthropic";
  return "openai";
}

/**
 * Ensures the model string includes a `provider/` prefix for the AI SDK gateway.
 * Claude models route to `anthropic/`; OpenAI models default to `openai/`.
 */
export function toGatewayModelString(
  model: string,
  defaultProvider: "anthropic" | "openai",
): string {
  const trimmed = model.trim();
  if (trimmed.includes("/")) {
    const provider = trimmed.slice(0, trimmed.indexOf("/"));
    const id = normalizeGatewayModelId(trimmed);
    return `${provider}/${id}`;
  }
  const provider = inferGatewayProvider(trimmed);
  const id = normalizeGatewayModelId(trimmed);
  const resolvedProvider = provider === "openai" ? defaultProvider : provider;
  return `${resolvedProvider}/${id}`;
}

function fallbackForKind(kind: GatewayModelKind): string {
  return kind === "structured" ? STRUCTURED_FALLBACK : TEXT_FALLBACK;
}

function defaultProviderForKind(
  kind: GatewayModelKind,
): "anthropic" | "openai" {
  return kind === "structured" ? "anthropic" : "openai";
}

function isFreeTierBlockedId(id: string): boolean {
  if (FREE_TIER_BLOCKED_IDS.has(id)) return true;
  if (id.startsWith("gpt-5")) return true;
  if (id.startsWith("claude-opus")) return true;
  return false;
}

/**
 * Rewrites gateway model ids that fail on the AI Gateway free tier to supported
 * defaults. Pass-through for env overrides and other supported models.
 *
 * @param raw - Requested model (`provider/model` or bare id).
 * @param kind - `structured` for `generateObject`, `text` for `generateText`.
 */
export function resolveGatewayModel(
  raw: string,
  kind: GatewayModelKind,
): ResolvedGatewayModel {
  const trimmed = raw.trim();
  if (!trimmed) {
    const fallback = fallbackForKind(kind);
    return {
      model: toGatewayModelString(fallback, defaultProviderForKind(kind)),
    };
  }

  const id = normalizeGatewayModelId(trimmed);
  if (isFreeTierBlockedId(id)) {
    const fallback = fallbackForKind(kind);
    return {
      model: toGatewayModelString(fallback, defaultProviderForKind(kind)),
      substitutedFrom: trimmed,
    };
  }

  return {
    model: toGatewayModelString(trimmed, defaultProviderForKind(kind)),
  };
}

/**
 * Model for `generateObject` calls. Honors `AI_GATEWAY_STRUCTURED_MODEL` when set.
 */
export function getStructuredGatewayModel(): string {
  const fromEnv = process.env.AI_GATEWAY_STRUCTURED_MODEL?.trim();
  return resolveGatewayModel(fromEnv ?? "", "structured").model;
}

/**
 * Model for match-report `generateText`. Honors `REPORT_GENERATE_MODEL` when set.
 */
export function getReportGenerateGatewayModel(): string {
  const fromEnv = process.env.REPORT_GENERATE_MODEL?.trim();
  return resolveGatewayModel(fromEnv ?? "", "text").model;
}

/**
 * Model for screenshot/VLM `generateObject` in report extract. Honors
 * `REPORT_EXTRACT_OPENAI_MODEL` when set; remaps stale or provider-mismatched
 * ids to the current OpenAI vision default.
 */
export function getReportExtractGatewayModel(): string {
  const fromEnv = process.env.REPORT_EXTRACT_OPENAI_MODEL?.trim();
  return resolveReportExtractGatewayModel(fromEnv ?? "").model;
}

/** Keeps screenshot extraction on OpenAI and repairs stale/provider-mismatched overrides. */
export function resolveReportExtractGatewayModel(
  raw: string,
): ResolvedGatewayModel {
  const requested = raw.trim();
  if (!requested) return { model: DEFAULT_REPORT_EXTRACT_GATEWAY_MODEL };

  const slash = requested.indexOf("/");
  const provider = slash >= 0 ? requested.slice(0, slash) : "openai";
  const id = gatewayModelId(requested);
  const invalidForOpenAi =
    !id ||
    provider !== "openai" ||
    id.startsWith("claude-") ||
    id === "gpt-5-chat-latest" ||
    id === "gpt-5.2-2025-12-11";

  if (!invalidForOpenAi) {
    return { model: toGatewayModelString(id, "openai") };
  }
  return {
    model: DEFAULT_REPORT_EXTRACT_GATEWAY_MODEL,
    substitutedFrom: requested,
  };
}

/**
 * Returns true when the error is the AI Gateway free-tier model access denial.
 */
export function isGatewayFreeTierAccessError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return (
    message.includes("Free tier users do not have access to this model") ||
    message.includes("Upgrade to paid credits")
  );
}
