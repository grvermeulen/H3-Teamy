import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

// OpenAI's structured-output (strict mode) via the Vercel AI Gateway requires
// every property listed in `properties` to also appear in `required`. Optional
// fields therefore have to be expressed as `.nullable()` (string | null), not
// `.optional()` (omittable from the JSON entirely). See Sentry incident on
// `/api/report/extract` 502 with "Invalid schema for response_format 'response'
// ... Missing 'time'".
const ExtractEventSchema = z.object({
  quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  time: z.string().nullable(),
  team: z.enum(["home", "away"]),
  type: z.enum(["goal", "personal_foul"]),
  player: z.string().nullable(),
});

const ExtractResultSchema = z.object({
  homeTeam: z.string().nullable(),
  awayTeam: z.string().nullable(),
  homeScore: z.number().nullable(),
  awayScore: z.number().nullable(),
  date: z.string().nullable(),
  events: z.array(ExtractEventSchema).nullable(),
});

type ExtractEvent = z.infer<typeof ExtractEventSchema>;
type ExtractResult = z.infer<typeof ExtractResultSchema>;

export type ExtractProvider = "vlm" | "ocr" | "hybrid";
type ConcreteProvider = "vlm" | "ocr";

export type ExtractProviderConfig = {
  provider: ExtractProvider;
  openAiModel: string;
  /** Present when `REPORT_EXTRACT_OPENAI_MODEL` was rewritten (e.g. removed gateway snapshot). */
  openAiModelSubstitutedFrom?: string;
  ocrWorkerUrl?: string;
  ocrWorkerToken?: string;
};

export type ExtractProviderSuccess = {
  result: ExtractResult;
  rawText: string;
  providerUsed: ConcreteProvider;
  model: string;
  /** Echo of {@link ExtractProviderConfig.openAiModelSubstitutedFrom} for structured logs. */
  openAiModelSubstitutedFrom?: string;
  fallbackUsed: boolean;
  latencyMs: number;
};

/**
 * Typed error raised by the extract pipeline. Carries the upstream HTTP
 * status, an internal `code` for log routing, and any provider metadata
 * already known when the failure occurred.
 */
export class ExtractProviderError extends Error {
  readonly code: string;
  readonly status: number;
  readonly info?: unknown;
  readonly provider?: ExtractProvider;
  readonly providerUsed?: ConcreteProvider;
  readonly model?: string;
  readonly fallbackUsed?: boolean;

  constructor(args: {
    message: string;
    code: string;
    status: number;
    info?: unknown;
    provider?: ExtractProvider;
    providerUsed?: ConcreteProvider;
    model?: string;
    fallbackUsed?: boolean;
  }) {
    super(args.message);
    this.code = args.code;
    this.status = args.status;
    this.info = args.info;
    this.provider = args.provider;
    this.providerUsed = args.providerUsed;
    this.model = args.model;
    this.fallbackUsed = args.fallbackUsed;
  }
}

function nowMs(): number {
  return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseProvider(raw?: string): ExtractProvider {
  if (raw === "ocr" || raw === "vlm" || raw === "hybrid") return raw;
  return "vlm";
}

/**
 * The AI Gateway expects model strings of the form `provider/model` (e.g.
 * `openai/gpt-4o`). Existing env values may be bare OpenAI model names like
 * `gpt-4o`; in that case we prepend `openai/` so the gateway routes correctly.
 */
function gatewayModelString(rawModel: string): string {
  return rawModel.includes("/") ? rawModel : `openai/${rawModel}`;
}

/** Vision-capable default when env is unset or points at a removed gateway model. */
const DEFAULT_REPORT_EXTRACT_OPENAI_MODEL = "gpt-4o";

/**
 * Strips a leading `openai/` prefix for comparisons only.
 */
function openAiModelIdWithoutProvider(model: string): string {
  const t = model.trim();
  return t.startsWith("openai/") ? t.slice("openai/".length) : t;
}

export type ResolvedReportExtractOpenAiModel = {
  model: string;
  substitutedFrom?: string;
};

/**
 * Resolves `REPORT_EXTRACT_OPENAI_MODEL` to a gateway-supported id. Uses
 * {@link DEFAULT_REPORT_EXTRACT_OPENAI_MODEL} when unset, and remaps snapshot ids
 * that the Vercel AI Gateway no longer serves (see Sentry JAVASCRIPT-NEXTJS-1F).
 *
 * @param raw - Value of `REPORT_EXTRACT_OPENAI_MODEL` (may be empty).
 * @returns The model string to pass to `gatewayModelString` / `generateObject`, and the original env value when it was rewritten.
 */
export function resolveReportExtractOpenAiModel(
  raw: string,
): ResolvedReportExtractOpenAiModel {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { model: DEFAULT_REPORT_EXTRACT_OPENAI_MODEL };
  }
  const id = openAiModelIdWithoutProvider(trimmed);
  if (id === "gpt-5.2-2025-12-11") {
    return {
      model: DEFAULT_REPORT_EXTRACT_OPENAI_MODEL,
      substitutedFrom: trimmed,
    };
  }
  return { model: trimmed };
}

/**
 * Reads and validates the report-extract environment configuration. Throws an
 * `ExtractProviderError` when required variables are missing so route
 * handlers can return a structured 500 instead of crashing with a generic
 * `TypeError`. `OPENAI_API_KEY` is no longer required here: AI calls go
 * through the Vercel AI Gateway, which handles upstream auth via OIDC in
 * production or `AI_GATEWAY_API_KEY` locally.
 *
 * When `REPORT_EXTRACT_OPENAI_MODEL` is unset, defaults to
 * `gpt-4o` (vision). A removed snapshot (`gpt-5.2-2025-12-11`) is remapped to
 * the same default so production does not depend on stale Vercel env values.
 */
export function getExtractProviderConfig(): ExtractProviderConfig {
  const provider = parseProvider(process.env.REPORT_EXTRACT_PROVIDER);
  const { model: openAiModel, substitutedFrom: openAiModelSubstitutedFrom } =
    resolveReportExtractOpenAiModel(
      process.env.REPORT_EXTRACT_OPENAI_MODEL || "",
    );
  const ocrWorkerUrl = (process.env.OCR_WORKER_URL || "").trim();
  const ocrWorkerToken = (process.env.OCR_WORKER_TOKEN || "").trim();

  const missing: string[] = [];
  if ((provider === "ocr" || provider === "hybrid") && !ocrWorkerUrl) {
    missing.push("OCR_WORKER_URL");
  }
  if ((provider === "ocr" || provider === "hybrid") && !ocrWorkerToken) {
    missing.push("OCR_WORKER_TOKEN");
  }

  if (missing.length > 0) {
    throw new ExtractProviderError({
      message: `Missing required extract env var(s): ${missing.join(", ")}`,
      code: "extract_provider_config_invalid",
      status: 500,
      info: { missing, provider },
      provider,
      model: openAiModel || undefined,
    });
  }

  return {
    provider,
    openAiModel,
    openAiModelSubstitutedFrom,
    ocrWorkerUrl: ocrWorkerUrl || undefined,
    ocrWorkerToken: ocrWorkerToken || undefined,
  };
}

function buildNormalizationPrompt(rawText: string): string {
  return `Lees de wedstrijdgegevens en geef ALLEEN geldig JSON terug in exact dit schema:
{
  "homeTeam": string,
  "awayTeam": string,
  "homeScore": number,
  "awayScore": number,
  "date"?: string,
  "events": Array<{
    "quarter": 1 | 2 | 3 | 4,
    "time": string,
    "team": "home" | "away",
    "type": "goal" | "personal_foul",
    "player"?: string
  }>
}
Regels:
- Home/away: in de header staat altijd een scoreblok "TEAM A 12-23 TEAM B". Het eerste team links (bovenaan) is altijd homeTeam; het team rechts op exact dezelfde hoogte is awayTeam.
- Bepaal het kwart uit sectiekoppen zoals "1e periode", "2e periode", enz. (1..4).
- Een event is uitsluitend "goal" als er in de regel een nieuwe stand staat in het formaat "X-Y" (bv. "0-1", "2-3"). Het doelpunt-icoon op zichzelf is niet voldoende.
- De volgende codes/iconen markeren altijd "personal_foul", ongeacht eventuele andere iconen:
  - "U18" — persoonlijke fout
  - "S" — strafworp veroorzaakt
  - "Umv" — uitsluiting met vervanging
  - "Umv4" — uitsluiting zonder vervanging
  - geel of rood kaart-icoon — gele/rode kaart
- "T" markeert een time-out: NEEM DEZE NIET OP in de events-array.
- Regels met andere codes of iconen die niet in deze lijst staan: laat weg.
- "team" is relatief: "home" verwijst naar homeTeam, "away" naar awayTeam.
- Neem namen en tijden exact over; zet "time" en "player" op null wanneer ze onleesbaar zijn (niet weglaten — het schema verwacht expliciet null).
- Sorteer events op quarter (1..4), daarna tijd oplopend.
- Geef uitsluitend het JSON-object terug, zonder extra tekst.

Tekst uit OCR:
【BEGIN】
${rawText}
【EINDE】`;
}

function buildVisionPrompt(): string {
  return `Lees de geuploade screenshot en geef ALLEEN geldig JSON terug in exact dit schema:
{
  "homeTeam": string,
  "awayTeam": string,
  "homeScore": number,
  "awayScore": number,
  "date"?: string,
  "events": Array<{
    "quarter": 1 | 2 | 3 | 4,
    "time": string,
    "team": "home" | "away",
    "type": "goal" | "personal_foul",
    "player"?: string
  }>
}
Regels:
- Home/away: in de header staat altijd een scoreblok "TEAM A 12-23 TEAM B". Het eerste team links (bovenaan) is altijd homeTeam; het team rechts op exact dezelfde hoogte is awayTeam.
- Bepaal het kwart uit sectiekoppen zoals "1e periode", "2e periode", enz. (1..4).
- Een event is uitsluitend "goal" als er in de regel een nieuwe stand staat in het formaat "X-Y" (bv. "0-1", "2-3"). Het doelpunt-icoon op zichzelf is niet voldoende.
- De volgende codes/iconen markeren altijd "personal_foul", ongeacht eventuele andere iconen:
  - "U18" — persoonlijke fout
  - "S" — strafworp veroorzaakt
  - "Umv" — uitsluiting met vervanging
  - "Umv4" — uitsluiting zonder vervanging
  - geel of rood kaart-icoon — gele/rode kaart
- "T" markeert een time-out: NEEM DEZE NIET OP in de events-array.
- Regels met andere codes of iconen die niet in deze lijst staan: laat weg.
- "team" is relatief: "home" verwijst naar homeTeam, "away" naar awayTeam.
- Neem namen en tijden exact over; zet "time" en "player" op null wanneer ze onleesbaar zijn (niet weglaten — het schema verwacht expliciet null).
- Sorteer events op quarter (1..4), daarna tijd oplopend.
- Geef uitsluitend het JSON-object terug, zonder extra tekst.`;
}

const SYSTEM_PROMPT =
  "Je bent een nauwkeurige parser die alleen geldige JSON terugstuurt.";

async function callAiTextNormalization(args: {
  model: string;
  rawText: string;
}): Promise<ExtractResult> {
  const { generateObject } = await import("./ai/client");
  try {
    const { object } = await generateObject({
      model: gatewayModelString(args.model),
      schema: ExtractResultSchema,
      temperature: 0.1,
      system: SYSTEM_PROMPT,
      prompt: buildNormalizationPrompt(args.rawText),
    });
    return object;
  } catch (error: unknown) {
    throw new ExtractProviderError({
      message: "OpenAI request failed",
      code: "openai_failed",
      status: 502,
      info: error instanceof Error ? error.message : String(error),
      model: args.model,
    });
  }
}

/**
 * Anthropic vision models reject images where any dimension exceeds 8000 px.
 * `sharp` downscales the longest side to fit so a single stitched screenshot
 * (often very tall) doesn't break extraction with Claude/Sonnet, while gpt-4o
 * keeps working unchanged. PNG is preserved so text rendering stays sharp.
 */
async function fitImageForVisionLimits(
  buffer: Buffer,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const MAX_DIMENSION = 7800;
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const meta = await sharp(buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) return { buffer, mimeType };
    if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
      return { buffer, mimeType };
    }
    const resized = await sharp(buffer)
      .resize({
        width: width >= height ? MAX_DIMENSION : undefined,
        height: height > width ? MAX_DIMENSION : undefined,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    return { buffer: resized, mimeType: "image/png" };
  } catch {
    // sharp could not read the buffer (e.g. unrecognized format in tests).
    // Fall through with the original payload — the VLM call will surface any
    // real client/provider error.
    return { buffer, mimeType };
  }
}

async function callAiVisionExtraction(args: {
  model: string;
  file: File;
}): Promise<ExtractResult> {
  const { generateObject } = await import("./ai/client");
  const rawBuffer = Buffer.from(await args.file.arrayBuffer());
  const rawMimeType = args.file.type || "image/png";
  const { buffer, mimeType } = await fitImageForVisionLimits(
    rawBuffer,
    rawMimeType,
  );
  try {
    const { object } = await generateObject({
      model: gatewayModelString(args.model),
      schema: ExtractResultSchema,
      temperature: 0.1,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildVisionPrompt() },
            { type: "image", image: buffer, mediaType: mimeType },
          ],
        },
      ],
    });
    return object;
  } catch (error: unknown) {
    throw new ExtractProviderError({
      message: "OpenAI request failed",
      code: "openai_failed",
      status: 502,
      info: error instanceof Error ? error.message : String(error),
      model: args.model,
    });
  }
}

async function callOcrWorker(args: {
  workerUrl: string;
  workerToken: string;
  file: File;
}): Promise<string> {
  const fd = new FormData();
  fd.append("image", args.file, args.file.name || "screenshot.png");
  const ocrResp = await fetch(`${args.workerUrl.replace(/\/$/, "")}/ocr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.workerToken}` },
    body: fd,
  });
  if (!ocrResp.ok) {
    const info = await ocrResp.text().catch(() => "");
    throw new ExtractProviderError({
      message: "OCR worker request failed",
      code: "ocr_failed",
      status: 502,
      info,
      providerUsed: "ocr",
    });
  }
  const ocrJson = (await ocrResp.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return toStringValue(ocrJson.raw_text) || "";
}

async function runVlm(
  file: File,
  config: ExtractProviderConfig,
): Promise<ExtractProviderSuccess> {
  const startedAt = nowMs();
  const result = await callAiVisionExtraction({
    model: config.openAiModel,
    file,
  });
  return {
    result,
    rawText: "",
    providerUsed: "vlm",
    model: config.openAiModel,
    openAiModelSubstitutedFrom: config.openAiModelSubstitutedFrom,
    fallbackUsed: false,
    latencyMs: nowMs() - startedAt,
  };
}

async function runOcr(
  file: File,
  config: ExtractProviderConfig,
): Promise<ExtractProviderSuccess> {
  const startedAt = nowMs();
  const rawText = await callOcrWorker({
    workerUrl: config.ocrWorkerUrl || "",
    workerToken: config.ocrWorkerToken || "",
    file,
  });
  const result = await callAiTextNormalization({
    model: config.openAiModel,
    rawText,
  });
  return {
    result,
    rawText,
    providerUsed: "ocr",
    model: config.openAiModel,
    openAiModelSubstitutedFrom: config.openAiModelSubstitutedFrom,
    fallbackUsed: false,
    latencyMs: nowMs() - startedAt,
  };
}

/**
 * Runs the configured extract pipeline against a screenshot file.
 * `vlm` uses a vision model directly; `ocr` runs OCR then normalizes the
 * text; `hybrid` tries `vlm` first and falls back to `ocr` on failure.
 */
export async function extractReportFromImage(
  file: File,
): Promise<ExtractProviderSuccess> {
  const config = getExtractProviderConfig();
  if (config.provider === "vlm") {
    return runVlm(file, config);
  }
  if (config.provider === "ocr") {
    return runOcr(file, config);
  }

  const startedAt = nowMs();
  try {
    const primary = await runVlm(file, config);
    return { ...primary, fallbackUsed: false, latencyMs: nowMs() - startedAt };
  } catch (vlmError: unknown) {
    Sentry.captureException(vlmError, {
      tags: {
        module: "report_extract",
        provider: "vlm",
        operation: "hybrid_fallback",
      },
      level: "warning",
    });
    const fallback = await runOcr(file, config);
    return { ...fallback, fallbackUsed: true, latencyMs: nowMs() - startedAt };
  }
}

export type { ExtractEvent, ExtractResult };
