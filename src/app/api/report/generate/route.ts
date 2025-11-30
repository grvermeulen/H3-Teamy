import { NextRequest, NextResponse } from "next/server";
import { getReport, setReport, kvGetJson } from "../../../../lib/kv";
import { MVP_PLACEHOLDER } from "../../../../lib/mvpNarrative";

type RawEvent = {
  quarter: 1 | 2 | 3 | 4;
  time?: string;
  team: "home" | "away";
  type: "goal" | "personal_foul";
  player?: string;
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

const OUR_TEAM_KEYWORDS = ["de rijn", "rijn h3", "rijn heren 3", "de rijn heren 3", "drh3"];

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
    const cached = await kvGetJson<{ id: string; name: string }[]>("users:roster:v1");
    if (Array.isArray(cached) && cached.length) {
      return cached.map((u) => u.name).filter(Boolean);
    }
  } catch {}
  return [];
}

function canonicalizePlayer(name: string | undefined, roster: string[]): string | null {
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

function guessPerspectiveFromEvents(events: RawEvent[] | undefined, roster: string[]): boolean | null {
  if (!Array.isArray(events) || events.length === 0 || roster.length === 0) return null;
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

function prepareNarrativeInput(input: {
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number;
  awayScore?: number;
  events?: RawEvent[];
}, rosterNames: string[]): NarrativeInput {
  const homeTeam = (input.homeTeam || "").trim() || "De Rijn Heren 3";
  const awayTeam = (input.awayTeam || "").trim() || "Onbekende tegenstander";
  const homeIsUs = isOurTeamName(homeTeam);
  const awayIsUs = isOurTeamName(awayTeam);
  let weAreHome: boolean;
  if (homeIsUs && !awayIsUs) {
    weAreHome = true;
  } else if (!homeIsUs && awayIsUs) {
    weAreHome = false;
  } else {
    const rosterGuess = guessPerspectiveFromEvents(input.events, rosterNames);
    if (rosterGuess !== null) {
      weAreHome = rosterGuess;
    } else {
      const baseline = normalizeName("De Rijn Heren 3");
      const homeSimilarity = similarity(normalizeName(homeTeam), baseline);
      const awaySimilarity = similarity(normalizeName(awayTeam), baseline);
      if (homeSimilarity > awaySimilarity) weAreHome = true;
      else if (awaySimilarity > homeSimilarity) weAreHome = false;
      else weAreHome = true;
    }
  }
  const opponentTeam = weAreHome ? awayTeam : homeTeam;
  const ourScore = weAreHome ? Number(input.homeScore) : Number(input.awayScore);
  const opponentScore = weAreHome ? Number(input.awayScore) : Number(input.homeScore);
  const preparedEvents: PreparedEvent[] = Array.isArray(input.events)
    ? input.events.map((evt) => {
        const perspective = weAreHome ? (evt.team === "home" ? "us" : "opponent") : (evt.team === "away" ? "us" : "opponent");
        const matchedPlayer = perspective === "us" ? canonicalizePlayer(evt.player, rosterNames) : null;
        return {
          quarter: evt.quarter,
          time: evt.time || "",
          team: perspective as "us" | "opponent",
          type: evt.type,
          player: matchedPlayer ?? undefined,
        };
      }).filter((evt) => Boolean(evt.time))
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

// Simplified generation: consume provided JSON and let the model write the report.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const eventId = body?.eventId as string | undefined;
    const source = (body && typeof body.result === "object" && body.result) || {};
    const input = {
      homeTeam: body?.homeTeam ?? (source as any)?.homeTeam ?? "De Rijn Heren 3",
      awayTeam: body?.awayTeam ?? body?.opponent ?? (source as any)?.awayTeam ?? "Onbekende tegenstander",
      homeScore: body?.homeScore ?? body?.scoreHome ?? (source as any)?.homeScore,
      awayScore: body?.awayScore ?? body?.scoreAway ?? (source as any)?.awayScore,
      date: body?.date ?? (source as any)?.date,
      events: Array.isArray(body?.events)
        ? body.events
        : (Array.isArray((source as any)?.events) ? (source as any).events : undefined),
    } as {
      homeTeam?: string;
      awayTeam?: string;
      homeScore?: number;
      awayScore?: number;
      date?: string;
      events?: Array<{ quarter: 1 | 2 | 3 | 4; time?: string; team: "home" | "away"; type: "goal" | "personal_foul"; player?: string }>;
    };
    if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });

    // Always (re)generate a fresh report on request

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

    // Validate that we actually have meaningful JSON for the model
    const hasScores = typeof input.homeScore === "number" && typeof input.awayScore === "number";
    const hasEvents = Array.isArray(input.events) && (input.events as any[]).length > 0;
    if (!hasScores || !hasEvents) {
      return NextResponse.json(
        { error: "report_input_incomplete", message: "Missing scores or events in JSON", received: input },
        { status: 422 }
      );
    }
    const rosterNames = await getRosterNames();
    const narrativeInput = prepareNarrativeInput(input, rosterNames);
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
- Noem nooit namen van individuele tegenstanders. Je mag de teamnaam (${narrativeInput.opponentTeam}) gebruiken, maar spreek verder over "de tegenstander".
- Meld opponent-events hooguit kort en zonder namen (bijv. "de tegenstander kwam nog even terug").
- Schrijf energiek en sportief, maximaal 2 uitroeptekens, en blijf positief vanuit ons perspectief.
- Sluit altijd af met de stand in de vorm ourScore-opponentScore en sluit af met exact deze zin op een eigen regel: "${MVP_PLACEHOLDER}"
- Gebruik uitsluitend de gegevens uit de JSON; geen eigen aannames of extra bronnen.`;

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-chat-latest",
        temperature: 0.2,
        input: [
          {
            role: "system",
            content: [ { type: "input_text", text: "You are an enthusiastic, pro–De Rijn Heren 3 reporter. Write energetic, respectful Dutch match reports using only the provided JSON." } ],
          },
          {
            role: "user",
            content: [ { type: "input_text", text: prompt } ],
          },
          {
            role: "user",
            content: [ { type: "input_text", text: `JSON:\n${JSON.stringify(narrativeInput)}` } ],
          },
        ],
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: "openai_failed", info: text }, { status: 502 });
    }
    const data = await resp.json();
    const content = (data?.output_text || data?.output?.[0]?.content?.[0]?.text || "").trim?.() || "";
    if (!content) return NextResponse.json({ error: "no_content" }, { status: 500 });

    const previous = await getReport(eventId);
    const report = { content, createdAt: new Date().toISOString(), authorId: previous?.authorId, mvpResult: previous?.mvpResult };
    await setReport(eventId, report);
    return NextResponse.json({ ok: true, report });
  } catch (e: any) {
    return NextResponse.json({ error: "failed", message: e?.message || String(e) }, { status: 500 });
  }
}


