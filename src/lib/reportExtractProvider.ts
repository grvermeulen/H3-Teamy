type ExtractEvent = {
  quarter: 1 | 2 | 3 | 4;
  time?: string;
  team: "home" | "away";
  type: "goal" | "personal_foul";
  player?: string;
};

type ExtractResult = {
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number;
  awayScore?: number;
  date?: string;
  events?: ExtractEvent[];
};

export type ExtractProvider = "vlm" | "ocr" | "hybrid";
type ConcreteProvider = "vlm" | "ocr";

export type ExtractProviderConfig = {
  provider: ExtractProvider;
  openAiModel: string;
  openAiApiKey: string;
  ocrWorkerUrl?: string;
  ocrWorkerToken?: string;
};

export type ExtractProviderSuccess = {
  result: ExtractResult;
  rawText: string;
  providerUsed: ConcreteProvider;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
};

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

function toNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isExtractEvent(value: unknown): value is ExtractEvent {
  if (!isRecord(value)) return false;
  const quarter = value.quarter;
  const team = value.team;
  const type = value.type;
  if (quarter !== 1 && quarter !== 2 && quarter !== 3 && quarter !== 4)
    return false;
  if (team !== "home" && team !== "away") return false;
  if (type !== "goal" && type !== "personal_foul") return false;
  if (value.time !== undefined && typeof value.time !== "string") return false;
  if (value.player !== undefined && typeof value.player !== "string")
    return false;
  return true;
}

function toExtractResult(value: unknown): ExtractResult {
  if (!isRecord(value)) return {};
  const events = Array.isArray(value.events)
    ? value.events.filter(isExtractEvent)
    : undefined;
  return {
    homeTeam: toStringValue(value.homeTeam),
    awayTeam: toStringValue(value.awayTeam),
    homeScore: toNumberValue(value.homeScore),
    awayScore: toNumberValue(value.awayScore),
    date: toStringValue(value.date),
    events: events && events.length > 0 ? events : undefined,
  };
}

function parseProvider(raw?: string): ExtractProvider {
  if (raw === "ocr" || raw === "vlm" || raw === "hybrid") return raw;
  return "vlm";
}

export function getExtractProviderConfig(): ExtractProviderConfig {
  const provider = parseProvider(process.env.REPORT_EXTRACT_PROVIDER);
  const openAiModel = (process.env.REPORT_EXTRACT_OPENAI_MODEL || "").trim();
  const openAiApiKey = (process.env.OPENAI_API_KEY || "").trim();
  const ocrWorkerUrl = (process.env.OCR_WORKER_URL || "").trim();
  const ocrWorkerToken = (process.env.OCR_WORKER_TOKEN || "").trim();

  const missing: string[] = [];
  if (!openAiApiKey) missing.push("OPENAI_API_KEY");
  if (!openAiModel) missing.push("REPORT_EXTRACT_OPENAI_MODEL");
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
    openAiApiKey,
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
- Icoon doelpunt = "goal"; "U20" = "personal_foul".
- "team" is relatief: "home" verwijst naar homeTeam, "away" naar awayTeam.
- Neem namen en tijden exact over; laat velden weg als ze onleesbaar zijn.
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
- Icoon doelpunt = "goal"; "U20" = "personal_foul".
- "team" is relatief: "home" verwijst naar homeTeam, "away" naar awayTeam.
- Neem namen en tijden exact over; laat velden weg als ze onleesbaar zijn.
- Sorteer events op quarter (1..4), daarna tijd oplopend.
- Geef uitsluitend het JSON-object terug, zonder extra tekst.`;
}

async function parseJsonFromChatResponse(
  resp: Response,
): Promise<ExtractResult> {
  if (!resp.ok) {
    const info = await resp.text().catch(() => "");
    throw new ExtractProviderError({
      message: "OpenAI request failed",
      code: "openai_failed",
      status: 502,
      info,
    });
  }
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0];
  const content =
    isRecord(first) &&
    isRecord(first.message) &&
    typeof first.message.content === "string"
      ? first.message.content
      : "{}";
  try {
    return toExtractResult(JSON.parse(content));
  } catch {
    return {};
  }
}

async function callOpenAiTextNormalization(args: {
  apiKey: string;
  model: string;
  rawText: string;
}): Promise<ExtractResult> {
  const payload = {
    model: args.model,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "Je bent een nauwkeurige parser die alleen geldige JSON terugstuurt.",
      },
      { role: "user", content: buildNormalizationPrompt(args.rawText) },
    ],
    response_format: { type: "json_object" },
  };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  return parseJsonFromChatResponse(resp);
}

async function callOpenAiVisionExtraction(args: {
  apiKey: string;
  model: string;
  file: File;
}): Promise<ExtractResult> {
  const buffer = Buffer.from(await args.file.arrayBuffer());
  const mime = args.file.type || "image/png";
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
  const payload = {
    model: args.model,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "Je bent een nauwkeurige parser die alleen geldige JSON terugstuurt.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: buildVisionPrompt() },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  return parseJsonFromChatResponse(resp);
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
  const result = await callOpenAiVisionExtraction({
    apiKey: config.openAiApiKey,
    model: config.openAiModel,
    file,
  });
  return {
    result,
    rawText: "",
    providerUsed: "vlm",
    model: config.openAiModel,
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
  const result = await callOpenAiTextNormalization({
    apiKey: config.openAiApiKey,
    model: config.openAiModel,
    rawText,
  });
  return {
    result,
    rawText,
    providerUsed: "ocr",
    model: config.openAiModel,
    fallbackUsed: false,
    latencyMs: nowMs() - startedAt,
  };
}

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
  } catch (error) {
    const fallback = await runOcr(file, config);
    return { ...fallback, fallbackUsed: true, latencyMs: nowMs() - startedAt };
  }
}
