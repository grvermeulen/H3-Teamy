import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getReport, setReport, kvGetJson } from "../../../../lib/kv";
import { MVP_PLACEHOLDER } from "../../../../lib/mvpNarrative";
import { sendMatchReportToWhatsAppGroup } from "../../../../lib/services/waapiService";
import { getActiveUsers } from "../../../../lib/services/userService";
import type { TeamEvent } from "../../../../types";

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
};

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
  const details = result.details ? ` (${result.details})` : "";
  Sentry.captureException(
    new Error(`WaAPI notification not sent: ${result.reason}${details}`),
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
    Sentry.captureException(error, {
      tags: { module: "report_generate", operation: "getRosterNames" },
    });
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

function extractTeamsFromTitle(title?: string | null): TitleTeams | null {
  if (!title) return null;
  const parts = title.split(/[-–—]/);
  if (parts.length < 2) return null;
  const home = parts[0]?.trim();
  const away = parts.slice(1).join("-").trim();
  if (!home || !away) return null;
  return { home, away };
}

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

  const titleTeams = extractTeamsFromTitle(eventMeta?.title);
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
  try {
    let body: ReportBody;
    try {
      body = (await req.json()) as ReportBody;
    } catch (error: unknown) {
      return NextResponse.json(
        { error: "invalid_json", message: "Invalid JSON payload." },
        { status: 400 },
      );
    }
    const eventId = toStringValue(body?.eventId);
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
    if (!eventId)
      return NextResponse.json({ error: "eventId required" }, { status: 400 });

    // Always (re)generate a fresh report on request

    // Validate that we actually have meaningful JSON for the model
    const hasScores =
      typeof input.homeScore === "number" &&
      typeof input.awayScore === "number";
    const hasEvents = Array.isArray(input.events) && input.events.length > 0;
    if (!hasScores || !hasEvents) {
      return NextResponse.json(
        {
          error: "report_input_incomplete",
          message: "Missing scores or events in JSON",
          received: input,
        },
        { status: 422 },
      );
    }
    const rosterNames = await getRosterNames();
    let eventMeta: TeamEvent | null = null;
    try {
      const cachedEvents = await kvGetJson<TeamEvent[]>("calendar:events:v1");
      eventMeta = cachedEvents?.find((evt) => evt.id === eventId) ?? null;
    } catch {
      eventMeta = null;
    }
    const narrativeInput = prepareNarrativeInput(input, rosterNames, eventMeta);
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
- Tel vóór het schrijven per speler hoe vaak die voorkomt in events met "type": "goal" en "team": "us". Vermeld in het verslag elke scorer minstens één keer — laat geen scorer weg — en noem geen scorer vaker dan dit aantal. Verzin geen extra goal-vermeldingen.
- Noem nooit namen van individuele tegenstanders. Je mag de teamnaam (${narrativeInput.opponentTeam}) gebruiken, maar spreek verder over "de tegenstander".
- Meld opponent-events hooguit kort en zonder namen (bijv. "de tegenstander kwam nog even terug").
- Schrijf energiek en sportief, maximaal 2 uitroeptekens, en blijf positief vanuit ons perspectief.
- Sluit altijd af met de stand in de vorm ourScore-opponentScore en sluit af met exact deze zin op een eigen regel: "${MVP_PLACEHOLDER}"
- Gebruik uitsluitend de gegevens uit de JSON; geen eigen aannames of extra bronnen.`;

    let content = "";
    try {
      const { generateText } = await import("../../../../lib/ai/client");
      const { text } = await generateText({
        model: "openai/gpt-5-chat-latest",
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
    } catch (aiError: unknown) {
      Sentry.captureException(aiError, {
        tags: { module: "report_generate", operation: "generateText" },
      });
      return NextResponse.json({ error: "openai_failed" }, { status: 502 });
    }
    if (!content)
      return NextResponse.json({ error: "no_content" }, { status: 500 });

    const previous = await getReport(eventId);
    const report = {
      content,
      createdAt: new Date().toISOString(),
      authorId: previous?.authorId,
      mvpResult: previous?.mvpResult,
    };
    await setReport(eventId, report);

    const notificationResult = await sendMatchReportToWhatsAppGroup({
      eventId,
      opponentTeam: narrativeInput.opponentTeam,
      ourScore: narrativeInput.ourScore,
      opponentScore: narrativeInput.opponentScore,
    });
    reportNotificationOutcome(notificationResult);

    return NextResponse.json({
      ok: true,
      report,
      whatsappNotification: notificationResult.sent
        ? { sent: true as const }
        : {
            sent: false as const,
            reason: notificationResult.reason,
            ...(notificationResult.details
              ? { details: notificationResult.details }
              : {}),
          },
    });
  } catch (error: unknown) {
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "failed", message }, { status: 500 });
  }
}
