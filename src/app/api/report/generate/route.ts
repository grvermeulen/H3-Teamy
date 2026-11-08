import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  parseAiSdkFailure,
  sanitizeReportFlowSentryExtra,
} from "../../../../lib/aiSdkFailureTelemetry";
import { getReportGenerateGatewayModel } from "../../../../lib/ai/gatewayModels";
import {
  buildGenerateDiagnosticResponse,
  classifyGenerateAiFailure,
  createReportFlowRequestId,
  logReportGenerateTrace,
  readGenerateFlowFromRequest,
} from "../../../../lib/reportGenerateDiagnostics";
import { getReport, setReport, kvGetJson } from "../../../../lib/kv";
import { MVP_PLACEHOLDER } from "../../../../lib/mvpNarrative";
import { sendMatchReportToWhatsAppGroup } from "../../../../lib/services/waapiService";
import { getActiveUsers } from "../../../../lib/services/userService";
import { isDbUnavailableError } from "../../../../lib/dbUnavailableError";
import type { TeamEvent } from "../../../../types";
import { extractTeamsFromEventTitle } from "../../../../lib/matchTitleTeams";

type RawEvent = {
  quarter: 1 | 2 | 3 | 4;
  time?: string;
  team: "home" | "away";
  type: "goal" | "personal_foul";
  player?: string;
};

// The extract provider emits `null` for absent string fields (required by
// OpenAI strict structured-output mode). `RawEvent` keeps the strict
// `string | undefined` shape, so we normalize at the boundary in
// `toRawEvents` after validating with `isRawEventInput`.
type RawEventInput = {
  quarter: 1 | 2 | 3 | 4;
  time?: string | null;
  team: "home" | "away";
  type: "goal" | "personal_foul";
  player?: string | null;
};

type ReportBody = {
  eventId?: unknown;
  matchTitle?: unknown;
  homeTeam?: unknown;
  awayTeam?: unknown;
  opponent?: unknown;
  homeScore?: unknown;
  scoreHome?: unknown;
  awayScore?: unknown;
  scoreAway?: unknown;
  date?: unknown;
  events?: unknown;
  result?: unknown;
  reportFlowId?: unknown;
};

function jsonGenerateResponse(
  body: Record<string, unknown>,
  status: number,
  requestId: string,
): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set("X-Report-Flow-Request-Id", requestId);
  return res;
}

function summarizeReportInput(
  body: ReportBody,
  input: {
    homeScore?: number;
    awayScore?: number;
    events?: unknown[];
  },
): {
  hasEventId: boolean;
  hasMatchTitle: boolean;
  hasHomeScore: boolean;
  hasAwayScore: boolean;
  eventsCount?: number;
  hasFlowId: boolean;
} {
  return {
    hasEventId: Boolean(toStringValue(body.eventId)),
    hasMatchTitle: Boolean(toStringValue(body.matchTitle)),
    hasHomeScore: typeof input.homeScore === "number",
    hasAwayScore: typeof input.awayScore === "number",
    eventsCount: Array.isArray(input.events) ? input.events.length : 0,
    hasFlowId: Boolean(toStringValue(body.reportFlowId)),
  };
}

type ResultBody = {
  homeTeam?: unknown;
  awayTeam?: unknown;
  homeScore?: unknown;
  awayScore?: unknown;
  date?: unknown;
  events?: unknown;
};

type PreparedEvent = {
  quarter: 1 | 2 | 3 | 4;
  time: string;
  team: "us" | "opponent";
  type: "goal" | "personal_foul";
  player?: string;
};

type NarrativeInput = {
  ourTeam: string;
  opponentTeam: string;
  ourScore: number;
  opponentScore: number;
  location: "home" | "away";
  events: PreparedEvent[];
  sourceTeams: { homeTeam?: string; awayTeam?: string };
};

function reportNotificationOutcome(
  result: Awaited<ReturnType<typeof sendMatchReportToWhatsAppGroup>>,
): void {
  if (result.sent) return;
  Sentry.setTag("waapi_notification_reason", result.reason);

  if (
    result.reason === "disabled" ||
    result.reason === "missing_config" ||
    result.reason === "invalid_event_id"
  ) {
    return;
  }

  const details = result.details ? `: ${result.details}` : "";
  Sentry.captureException(
    new Error(`WaAPI notification not sent (${result.reason})${details}`),
  );
}

const OUR_TEAM_KEYWORDS = [
  "de rijn",
  "rijn h3",
  "rijn heren 3",
  "de rijn heren 3",
  "drh3",
];

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

function isRawEventInput(value: unknown): value is RawEventInput {
  if (!isRecord(value)) return false;
  const quarter = value.quarter;
  const team = value.team;
  const type = value.type;
  if (quarter !== 1 && quarter !== 2 && quarter !== 3 && quarter !== 4)
    return false;
  if (team !== "home" && team !== "away") return false;
  if (type !== "goal" && type !== "personal_foul") return false;
  if (
    value.time !== undefined &&
    value.time !== null &&
    typeof value.time !== "string"
  )
    return false;
  if (
    value.player !== undefined &&
    value.player !== null &&
    typeof value.player !== "string"
  )
    return false;
  return true;
}

function toRawEvents(value: unknown): RawEvent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const events: RawEvent[] = value.filter(isRawEventInput).map((evt) => ({
    quarter: evt.quarter,
    team: evt.team,
    type: evt.type,
    time: evt.time ?? undefined,
    player: evt.player ?? undefined,
  }));
  return events.length ? events : undefined;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isOurTeamName(name?: string | null): boolean {
  if (!name) return false;
  const norm = normalizeName(name);
  return OUR_TEAM_KEYWORDS.some((kw) => norm.includes(kw));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, () => 0);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    let min = i;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
      if (dp[j] < min) min = dp[j];
    }
  }
  return dp[b.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 0;
  return 1 - dist / maxLen;
}

async function getRosterNames(): Promise<string[]> {
  try {
    const users = await getActiveUsers();
    return users.map((u) => u.name).filter(Boolean);
  } catch (error: unknown) {
    if (!isDbUnavailableError(error)) {
      Sentry.captureException(error, {
        tags: { module: "report_generate", operation: "getRosterNames" },
      });
    }
    return [];
  }
}

function canonicalizePlayer(
  name: string | undefined,
  roster: string[],
): string | null {
  const raw = (name || "").trim();
  if (!raw) return null;
  const norm = normalizeName(raw);
  if (!norm) return null;
  let bestName: string | null = null;
  let bestScore = 0;
  for (const candidate of roster) {
    const score = similarity(norm, normalizeName(candidate));
    if (score > bestScore) {
      bestScore = score;
      bestName = candidate;
    }
  }
  return bestScore >= 0.72 ? bestName : null;
}

function guessPerspectiveFromEvents(
  events: RawEvent[] | undefined,
  roster: string[],
): boolean | null {
  if (!Array.isArray(events) || events.length === 0 || roster.length === 0)
    return null;
  let homeHits = 0;
  let awayHits = 0;
  for (const evt of events) {
    if (!evt?.player) continue;
    const canonical = canonicalizePlayer(evt.player, roster);
    if (!canonical) continue;
    if (evt.team === "home") homeHits += 1;
    else if (evt.team === "away") awayHits += 1;
  }
  if (homeHits === awayHits) return null;
  return homeHits > awayHits;
}

type TitleTeams = { home?: string; away?: string };

function inferHomeFromTitle(teams?: TitleTeams | null): boolean | null {
  if (!teams?.home || !teams?.away) return null;
  const homeIsUs = isOurTeamName(teams.home);
  const awayIsUs = isOurTeamName(teams.away);
  if (homeIsUs && !awayIsUs) return true;
  if (!homeIsUs && awayIsUs) return false;
  return null;
}

function prepareNarrativeInput(
  input: {
    homeTeam?: string;
    awayTeam?: string;
    homeScore?: number;
    awayScore?: number;
    events?: RawEvent[];
  },
  rosterNames: string[],
  eventMeta?: TeamEvent | null,
): NarrativeInput {
  const homeTeam = (input.homeTeam || "").trim() || "De Rijn Heren 3";
  const awayTeam = (input.awayTeam || "").trim() || "Onbekende tegenstander";
  const homeIsUs = isOurTeamName(homeTeam);
  const awayIsUs = isOurTeamName(awayTeam);
  let weAreHome: boolean | null = null;

  const titleTeams = extractTeamsFromEventTitle(eventMeta?.title);
  const titleGuess = inferHomeFromTitle(titleTeams);
  if (titleGuess !== null) {
    weAreHome = titleGuess;
  }

  if (weAreHome === null) {
    if (homeIsUs && !awayIsUs) weAreHome = true;
    else if (!homeIsUs && awayIsUs) weAreHome = false;
  }

  if (weAreHome === null) {
    const rosterGuess = guessPerspectiveFromEvents(input.events, rosterNames);
    if (rosterGuess !== null) {
      weAreHome = rosterGuess;
    }
  }

  if (weAreHome === null) {
    const baseline = normalizeName("De Rijn Heren 3");
    const homeSimilarity = similarity(normalizeName(homeTeam), baseline);
    const awaySimilarity = similarity(normalizeName(awayTeam), baseline);
    if (homeSimilarity > awaySimilarity) weAreHome = true;
    else if (awaySimilarity > homeSimilarity) weAreHome = false;
    else weAreHome = true;
  }
  let opponentTeam = weAreHome ? awayTeam : homeTeam;
  if (titleTeams) {
    if (weAreHome && titleTeams.away && !isOurTeamName(titleTeams.away)) {
      opponentTeam = titleTeams.away;
    } else if (
      !weAreHome &&
      titleTeams.home &&
      !isOurTeamName(titleTeams.home)
    ) {
      opponentTeam = titleTeams.home;
    }
  }
  if (!opponentTeam || isOurTeamName(opponentTeam)) {
    const fallback = weAreHome ? awayTeam : homeTeam;
    if (fallback && !isOurTeamName(fallback)) {
      opponentTeam = fallback;
    }
  }
  if (!opponentTeam) {
    opponentTeam = weAreHome ? awayTeam : homeTeam;
  }
  const ourScore = weAreHome
    ? Number(input.homeScore)
    : Number(input.awayScore);
  const opponentScore = weAreHome
    ? Number(input.awayScore)
    : Number(input.homeScore);
  const preparedEvents: PreparedEvent[] = Array.isArray(input.events)
    ? input.events
        .map((evt) => {
          const perspective = weAreHome
            ? evt.team === "home"
              ? "us"
              : "opponent"
            : evt.team === "away"
              ? "us"
              : "opponent";
          const matchedPlayer =
            perspective === "us"
              ? canonicalizePlayer(evt.player, rosterNames)
              : null;
          return {
            quarter: evt.quarter,
            time: evt.time || "",
            team: perspective as "us" | "opponent",
            type: evt.type,
            player: matchedPlayer ?? undefined,
          };
        })
        .filter((evt) => Boolean(evt.time))
    : [];
  return {
    ourTeam: "De Rijn Heren 3",
    opponentTeam: opponentTeam || "Onbekende tegenstander",
    ourScore,
    opponentScore,
    location: weAreHome ? "home" : "away",
    events: preparedEvents,
    sourceTeams: { homeTeam, awayTeam },
  };
}

/**
 * Genereert een Nederlandstalig wedstrijdverslag uit de geleverde JSON en
 * verstuurt een notificatie naar de WhatsApp-groep.
 *
 * Verwacht een `ReportBody` met `eventId`, scores en events. Spelersnamen in
 * "us"-events worden gematcht tegen de actuele roster (fuzzy via Levenshtein,
 * drempel 0.72); bij een onmatchbare naam vervalt deze, zodat het AI-prompt
 * algemene formuleringen gebruikt. Een geslaagde generatie cachet het verslag
 * via `setReport` en vuurt `sendMatchReportToWhatsAppGroup`.
 *
 * @param req - Next.js request met JSON-body (`ReportBody`).
 * @returns 200 met `{ ok, report, whatsappNotification }`,
 *   400 bij ongeldige JSON of ontbrekende `eventId`,
 *   422 wanneer scores of events ontbreken,
 *   502 wanneer het AI-model faalt,
 *   500 bij een onverwachte fout.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const requestId = createReportFlowRequestId();
  const headerFlow = readGenerateFlowFromRequest(req);
  let flowId = headerFlow.flowId;
  const vercelRequestId = headerFlow.vercelRequestId;

  try {
    let body: ReportBody;
    const jsonStartedAt = Date.now();
    try {
      body = (await req.json()) as ReportBody;
    } catch (error: unknown) {
      logReportGenerateTrace({
        flowId,
        requestId,
        vercelRequestId,
        phase: "json_fail",
        startedAt,
        stageStartedAt: jsonStartedAt,
        outcome: "error",
        appHttpStatus: 400,
        errorClass: "invalid_json",
        errorCode: "invalid_json",
      });
      return jsonGenerateResponse(
        {
          error: "invalid_json",
          message: "Ongeldige invoer naar de server. Probeer opnieuw.",
          diagnostic: buildGenerateDiagnosticResponse({
            flowId,
            requestId,
            errorClass: "invalid_json",
          }),
        },
        400,
        requestId,
      );
    }
    const resolvedFlow = readGenerateFlowFromRequest(
      req,
      toStringValue(body.reportFlowId),
    );
    flowId = resolvedFlow.flowId;

    logReportGenerateTrace({
      flowId,
      requestId,
      vercelRequestId,
      phase: "entry",
      startedAt,
    });

    const eventId = toStringValue(body?.eventId);
    const matchTitle = toStringValue(body.matchTitle);
    const source: ResultBody = isRecord(body.result)
      ? (body.result as ResultBody)
      : {};
    const input = {
      homeTeam:
        toStringValue(body.homeTeam) ??
        toStringValue(source.homeTeam) ??
        "De Rijn Heren 3",
      awayTeam:
        toStringValue(body.awayTeam) ??
        toStringValue(body.opponent) ??
        toStringValue(source.awayTeam) ??
        "Onbekende tegenstander",
      homeScore:
        toNumberValue(body.homeScore) ??
        toNumberValue(body.scoreHome) ??
        toNumberValue(source.homeScore),
      awayScore:
        toNumberValue(body.awayScore) ??
        toNumberValue(body.scoreAway) ??
        toNumberValue(source.awayScore),
      date: toStringValue(body.date) ?? toStringValue(source.date),
      events: toRawEvents(body.events) ?? toRawEvents(source.events),
    } as {
      homeTeam?: string;
      awayTeam?: string;
      homeScore?: number;
      awayScore?: number;
      date?: string;
      events?: Array<{
        quarter: 1 | 2 | 3 | 4;
        time?: string;
        team: "home" | "away";
        type: "goal" | "personal_foul";
        player?: string;
      }>;
    };
    const inputSummary = summarizeReportInput(body, input);

    if (!eventId) {
      logReportGenerateTrace({
        flowId,
        requestId,
        vercelRequestId,
        phase: "validate_fail",
        startedAt,
        outcome: "error",
        appHttpStatus: 400,
        errorClass: "event_id_missing",
        errorCode: "event_id_required",
        inputSummary,
      });
      return jsonGenerateResponse(
        {
          error: "event_id_required",
          message: "eventId required",
          diagnostic: buildGenerateDiagnosticResponse({
            flowId,
            requestId,
            errorClass: "event_id_missing",
          }),
        },
        400,
        requestId,
      );
    }

    let eventMeta: TeamEvent | null = null;
    try {
      const cachedEvents = await kvGetJson<TeamEvent[]>("calendar:events:v1");
      eventMeta = cachedEvents?.find((evt) => evt.id === eventId) ?? null;
    } catch {
      eventMeta = null;
    }

    const fixtureTitle = matchTitle ?? eventMeta?.title ?? null;
    const titleTeams = extractTeamsFromEventTitle(fixtureTitle);
    const unknownAway = "Onbekende tegenstander";
    if (titleTeams) {
      if (!toStringValue(body.homeTeam) && !toStringValue(source.homeTeam)) {
        input.homeTeam = titleTeams.home;
      }
      if (
        input.awayTeam === unknownAway &&
        !toStringValue(body.awayTeam) &&
        !toStringValue(source.awayTeam)
      ) {
        input.awayTeam = titleTeams.away;
      }
    }

    // Always (re)generate a fresh report on request

    // Validate that we actually have meaningful JSON for the model
    const hasScores =
      typeof input.homeScore === "number" &&
      typeof input.awayScore === "number";
    const hasEvents = Array.isArray(input.events) && input.events.length > 0;
    if (!hasScores || !hasEvents) {
      logReportGenerateTrace({
        flowId,
        requestId,
        vercelRequestId,
        phase: "validate_fail",
        startedAt,
        outcome: "error",
        appHttpStatus: 422,
        errorClass: "report_input_incomplete",
        errorCode: "report_input_incomplete",
        inputSummary,
      });
      return jsonGenerateResponse(
        {
          error: "report_input_incomplete",
          message:
            "De screenshot mist een herkenbare eindstand of wedstrijdgebeurtenissen. Kies een volledige KNZB/Sportlink-screenshot bij deze wedstrijd.",
          diagnostic: buildGenerateDiagnosticResponse({
            flowId,
            requestId,
            errorClass: "report_input_incomplete",
          }),
        },
        422,
        requestId,
      );
    }

    logReportGenerateTrace({
      flowId,
      requestId,
      vercelRequestId,
      phase: "input_ok",
      startedAt,
      inputSummary,
    });
    const rosterNames = await getRosterNames();
    const narrativeEventMeta: TeamEvent | null =
      fixtureTitle != null
        ? eventMeta
          ? { ...eventMeta, title: fixtureTitle }
          : {
              id: eventId,
              title: fixtureTitle,
              start: new Date(0).toISOString(),
            }
        : eventMeta;
    const narrativeInput = prepareNarrativeInput(
      input,
      rosterNames,
      narrativeEventMeta,
    );
    const prompt = `Je krijgt JSON met wedstrijdgegevens in dit schema:
{
  "ourTeam": string,          // altijd "De Rijn Heren 3"
  "opponentTeam": string,
  "ourScore": number,
  "opponentScore": number,
  "location": "home" | "away",
  "events": Array<{
    "quarter": 1 | 2 | 3 | 4,
    "time": string,
    "team": "us" | "opponent",
    "type": "goal" | "personal_foul",
    "player"?: string         // alleen aanwezig bij onze spelers
  }>
}

Regels:
- "Wij/ons" = De Rijn Heren 3, ongeacht of we thuis of uit spelen.
- Baseer het resultaat uitsluitend op ourScore versus opponentScore. Benoem expliciet dat wij gewonnen hebben bij ourScore > opponentScore, verloren bij ourScore < opponentScore, of dat het gelijkspel was wanneer de scores gelijk zijn.
- Gebruik alleen spelersnamen die voorkomen bij events met "team": "us". Als er geen naam staat, omschrijf de actie algemeen ("een van onze schutters") maar verzin geen namen.
- Tel vóór het schrijven per speler hoe vaak die voorkomt in events met "type": "goal" en "team": "us". Gebruik deze telling exact: noem elke scorer precies even vaak als het getelde aantal doelpunten (niet minder, niet meer). Laat geen scorer weg en verzin geen extra goal-vermeldingen.
- Noem nooit namen van individuele tegenstanders. Je mag de teamnaam (${narrativeInput.opponentTeam}) gebruiken, maar spreek verder over "de tegenstander".
- Meld opponent-events hooguit kort en zonder namen (bijv. "de tegenstander kwam nog even terug").
- Schrijf energiek en sportief, maximaal 2 uitroeptekens, en blijf positief vanuit ons perspectief.
- Sluit altijd af met de stand in de vorm ourScore-opponentScore en sluit af met exact deze zin op een eigen regel: "${MVP_PLACEHOLDER}"
- Gebruik uitsluitend de gegevens uit de JSON; geen eigen aannames of extra bronnen.`;

    let content = "";
    const aiStartedAt = Date.now();
    const generateModel = getReportGenerateGatewayModel();
    logReportGenerateTrace({
      flowId,
      requestId,
      vercelRequestId,
      phase: "ai_start",
      startedAt,
      provider: { model: generateModel },
    });
    try {
      const { generateText } = await import("../../../../lib/ai/client");
      const { text } = await generateText({
        model: generateModel,
        temperature: 0.2,
        system:
          "You are an enthusiastic, pro–De Rijn Heren 3 reporter. Write energetic, respectful Dutch match reports using only the provided JSON.",
        messages: [
          { role: "user", content: prompt },
          {
            role: "user",
            content: `JSON:\n${JSON.stringify(narrativeInput)}`,
          },
        ],
      });
      content = text.trim();
      logReportGenerateTrace({
        flowId,
        requestId,
        vercelRequestId,
        phase: "ai_ok",
        startedAt,
        stageStartedAt: aiStartedAt,
        provider: { model: generateModel },
      });
    } catch (aiError: unknown) {
      const providerTelemetry = parseAiSdkFailure(aiError);
      const errorClass = classifyGenerateAiFailure(providerTelemetry);
      logReportGenerateTrace({
        flowId,
        requestId,
        vercelRequestId,
        phase: "ai_fail",
        startedAt,
        stageStartedAt: aiStartedAt,
        outcome: "error",
        appHttpStatus: 502,
        errorClass,
        errorCode: "openai_failed",
        provider: { model: generateModel },
        providerTelemetry,
      });
      Sentry.captureException(aiError, {
        tags: {
          module: "report_generate",
          operation: "generateText",
          error_class: errorClass,
          sdk_error: providerTelemetry.sdkErrorName,
          failure_kind: providerTelemetry.failureKind,
        },
        extra: sanitizeReportFlowSentryExtra({
          flowId,
          requestId,
          vercelRequestId,
          appHttpStatus: 502,
          upstreamHttpStatus: providerTelemetry.upstreamHttpStatus,
          providerTelemetry,
        }),
      });
      return jsonGenerateResponse(
        {
          error: "openai_failed",
          diagnostic: buildGenerateDiagnosticResponse({
            flowId,
            requestId,
            errorClass,
          }),
        },
        502,
        requestId,
      );
    }
    if (!content) {
      logReportGenerateTrace({
        flowId,
        requestId,
        vercelRequestId,
        phase: "ai_fail",
        startedAt,
        outcome: "error",
        appHttpStatus: 500,
        errorClass: "no_content",
        errorCode: "no_content",
      });
      return jsonGenerateResponse(
        {
          error: "no_content",
          message:
            "Het verslag kon niet worden gegenereerd (lege tekst van de AI). Probeer het later opnieuw.",
          diagnostic: buildGenerateDiagnosticResponse({
            flowId,
            requestId,
            errorClass: "no_content",
          }),
        },
        500,
        requestId,
      );
    }

    const persistStartedAt = Date.now();
    logReportGenerateTrace({
      flowId,
      requestId,
      vercelRequestId,
      phase: "persist_start",
      startedAt,
    });

    let previous;
    try {
      previous = await getReport(eventId);
    } catch (readError: unknown) {
      logReportGenerateTrace({
        flowId,
        requestId,
        vercelRequestId,
        phase: "persist_fail",
        startedAt,
        stageStartedAt: persistStartedAt,
        outcome: "error",
        appHttpStatus: 503,
        errorClass: isDbUnavailableError(readError)
          ? "db_unavailable"
          : "persist_read_failed",
        errorCode: "persist_read_failed",
        persistence: { outcome: "failed", category: "kv" },
      });
      Sentry.captureException(readError, {
        tags: { module: "report_generate", operation: "getReport" },
        extra: sanitizeReportFlowSentryExtra({ flowId, requestId }),
      });
      return jsonGenerateResponse(
        {
          error: "persist_failed",
          message:
            "Het bestaande verslag kon niet worden geladen. Probeer het later opnieuw.",
          diagnostic: buildGenerateDiagnosticResponse({
            flowId,
            requestId,
            errorClass: "persist_read_failed",
          }),
        },
        isDbUnavailableError(readError) ? 503 : 500,
        requestId,
      );
    }
    const report = {
      content,
      createdAt: new Date().toISOString(),
      authorId: previous?.authorId,
      mvpResult: previous?.mvpResult,
    };
    try {
      await setReport(eventId, report);
    } catch (persistError: unknown) {
      logReportGenerateTrace({
        flowId,
        requestId,
        vercelRequestId,
        phase: "persist_fail",
        startedAt,
        stageStartedAt: persistStartedAt,
        outcome: "error",
        appHttpStatus: 500,
        errorClass: isDbUnavailableError(persistError)
          ? "db_unavailable"
          : "persist_failed",
        errorCode: "persist_failed",
        persistence: {
          outcome: "failed",
          category: isDbUnavailableError(persistError) ? "unavailable" : "kv",
        },
      });
      Sentry.captureException(persistError, {
        tags: { module: "report_generate", operation: "setReport" },
        extra: sanitizeReportFlowSentryExtra({ flowId, requestId }),
      });
      return jsonGenerateResponse(
        {
          error: "persist_failed",
          message:
            "Het verslag kon niet worden opgeslagen. Probeer het later opnieuw.",
          diagnostic: buildGenerateDiagnosticResponse({
            flowId,
            requestId,
            errorClass: "persist_failed",
          }),
        },
        isDbUnavailableError(persistError) ? 503 : 500,
        requestId,
      );
    }

    logReportGenerateTrace({
      flowId,
      requestId,
      vercelRequestId,
      phase: "persist_ok",
      startedAt,
      stageStartedAt: persistStartedAt,
      persistence: { outcome: "saved", category: "kv" },
    });

    const notificationResult = await sendMatchReportToWhatsAppGroup({
      eventId,
      opponentTeam: narrativeInput.opponentTeam,
      ourScore: narrativeInput.ourScore,
      opponentScore: narrativeInput.opponentScore,
    });
    reportNotificationOutcome(notificationResult);

    logReportGenerateTrace({
      flowId,
      requestId,
      vercelRequestId,
      phase: "notify",
      startedAt,
      persistence: { outcome: "saved", category: "kv" },
    });

    logReportGenerateTrace({
      flowId,
      requestId,
      vercelRequestId,
      phase: "completed",
      startedAt,
      outcome: "success",
      appHttpStatus: 200,
      persistence: { outcome: "saved", category: "kv" },
    });

    return jsonGenerateResponse(
      {
        ok: true,
        report,
        diagnostic: buildGenerateDiagnosticResponse({ flowId, requestId }),
        whatsappNotification: notificationResult.sent
          ? { sent: true as const }
          : {
              sent: false as const,
              reason: notificationResult.reason,
              ...(notificationResult.details
                ? { details: notificationResult.details }
                : {}),
            },
      },
      200,
      requestId,
    );
  } catch (error: unknown) {
    logReportGenerateTrace({
      flowId,
      requestId,
      vercelRequestId,
      phase: "failed",
      startedAt,
      outcome: "error",
      appHttpStatus: 500,
      errorClass: "unexpected",
      errorCode: "failed",
    });
    Sentry.captureException(error, {
      tags: { module: "report_generate", error_class: "unexpected" },
      extra: sanitizeReportFlowSentryExtra({
        flowId,
        requestId,
        vercelRequestId,
      }),
    });
    return jsonGenerateResponse(
      {
        error: "failed",
        message: "Verslag genereren mislukt.",
        diagnostic: buildGenerateDiagnosticResponse({
          flowId,
          requestId,
          errorClass: "unexpected",
        }),
      },
      500,
      requestId,
    );
  }
}
