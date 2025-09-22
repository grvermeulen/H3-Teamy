import { NextRequest, NextResponse } from "next/server";
import { getReport, setReport } from "../../../../lib/kv";
import { getActiveUser } from "../../../../lib/activeUser";
import { prisma } from "../../../../lib/db";

function isAdminName(a: string | undefined, b: string) {
  const na = (a || "").toLowerCase().trim();
  const nb = (b || "").toLowerCase().trim();
  return na === nb;
}

function normalizeWhitespace(s: string) {
  return s.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

type RosterEntry = {
  id: string;
  firstName: string;
  lastName: string;
  full: string;
  firstLower: string;
  lastLower: string;
  firstInitial: string;
};

function buildRosterIndex(users: { id: string; firstName: string | null; lastName: string | null }[]) {
  const roster: RosterEntry[] = [];
  for (const u of users) {
    const first = (u.firstName || "").trim();
    const last = (u.lastName || "").trim();
    if (!first && !last) continue;
    const full = `${first} ${last}`.trim();
    roster.push({
      id: u.id,
      firstName: first,
      lastName: last,
      full,
      firstLower: first.toLowerCase(),
      lastLower: last.toLowerCase(),
      firstInitial: first ? first[0].toLowerCase() : "",
    });
  }

  const fullMap = new Map<string, RosterEntry>();
  const initialLastMap = new Map<string, RosterEntry>();
  const lastNameMap = new Map<string, RosterEntry[]>();
  const firstNameMap = new Map<string, RosterEntry[]>();

  for (const r of roster) {
    fullMap.set(normalizeWhitespace(r.full), r);
    if (r.firstInitial && r.lastLower) {
      initialLastMap.set(`${r.firstInitial} ${r.lastLower}`, r);
    }
    if (r.lastLower) {
      const arr = lastNameMap.get(r.lastLower) || [];
      arr.push(r);
      lastNameMap.set(r.lastLower, arr);
    }
    if (r.firstLower) {
      const arr = firstNameMap.get(r.firstLower) || [];
      arr.push(r);
      firstNameMap.set(r.firstLower, arr);
    }
  }

  function resolveOne(input: string): RosterEntry | null {
    const s = normalizeWhitespace(input);
    if (!s) return null;

    // Exact full name
    const exact = fullMap.get(s);
    if (exact) return exact;

    // Try initial + last: "g vermeulen"
    const parts = s.split(" ");
    if (parts.length >= 2) {
      const firstToken = parts[0];
      const lastToken = parts[parts.length - 1];
      if (firstToken.length === 1) {
        const cand = initialLastMap.get(`${firstToken} ${lastToken}`);
        if (cand) return cand;
      }
    }

    // Unique last name only
    if (parts.length === 1) {
      const lastOnly = lastNameMap.get(parts[0]);
      if (lastOnly && lastOnly.length === 1) return lastOnly[0];
      const firstOnly = firstNameMap.get(parts[0]);
      if (firstOnly && firstOnly.length === 1) return firstOnly[0];
    }

    // First + last without considering middle tokens
    if (parts.length >= 2) {
      const firstToken = parts[0];
      const lastToken = parts[parts.length - 1];
      // Match by first initial and full last
      const initCand = initialLastMap.get(`${firstToken[0]} ${lastToken}`);
      if (initCand) return initCand;
      // If first name unique and last matches any
      const firstMatches = firstNameMap.get(firstToken) || [];
      const narrowed = firstMatches.filter((r) => r.lastLower === lastToken);
      if (narrowed.length === 1) return narrowed[0];
    }

    return null;
  }

  function resolveMany(inputs: string[] | undefined): string[] | undefined {
    if (!inputs || !Array.isArray(inputs)) return undefined;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of inputs) {
      const candidate = resolveOne(raw);
      const name = candidate?.full?.trim();
      if (!name) continue;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push(name);
    }
    return out.length ? out : undefined;
  }

  function resolveMaybeOne(input: string | undefined): string | undefined {
    if (!input) return undefined;
    const cand = resolveOne(input);
    return cand?.full?.trim() || undefined;
  }

  return { resolveMany, resolveMaybeOne };
}

async function ensureAdmin(req: NextRequest) {
  const configured = process.env.ADMIN_FULL_NAME || "Guido Vermeulen";
  const { userId } = await getActiveUser(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const full = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  if (!isAdminName(full, configured)) return null;
  return { userId, full };
}

export async function POST(req: NextRequest) {
  try {
    const admin = await ensureAdmin(req);
    if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({} as any));
    const eventId = body?.eventId as string | undefined;
    const scoreHome = body?.scoreHome as number | undefined;
    const scoreAway = body?.scoreAway as number | undefined;
    const opponent = body?.opponent as string | undefined;
    const venue = body?.venue as string | undefined;
    const scorersInput = body?.scorers as string[] | undefined;
    const mvpInput = body?.mvp as string | undefined;
    const periods = body?.periods as (number | string)[] | undefined;
    const highlights = body?.highlights as string[] | undefined;
    const events = body?.events as Array<{
      quarter: 1 | 2 | 3 | 4;
      time?: string;
      team: "home" | "away";
      type: "goal" | "penalty" | "personal_foul";
      player?: string;
    }> | undefined;
    if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });

    // Always (re)generate a fresh report on request

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

    // Build detailed match info for the prompt (with validated player names)
    // Fetch roster and build a resolver to map provided names to known users
    const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true } });
    const { resolveMany, resolveMaybeOne } = buildRosterIndex(users);
    const scorers = resolveMany(scorersInput);
    const mvp = resolveMaybeOne(mvpInput);

    // Validate event player names via roster as well
    let eventsForPrompt: string | undefined = undefined;
    if (events && Array.isArray(events) && events.length) {
      function parseTimeToSeconds(s?: string) {
        if (!s) return Number.MAX_SAFE_INTEGER;
        const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
        if (!m) return Number.MAX_SAFE_INTEGER;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      }

      // Consider De Rijn H3 (home) events to drive our narrative and stats
      const home = events.filter((e) => e.team === "home");

      const grouped: Record<number, Array<{ t: number; line: string; type: string; player?: string }>> = {
        1: [], 2: [], 3: [], 4: [],
      };
      const goalsBy = new Map<string, number>();
      const foulsBy = new Map<string, number>();

      for (const e of home) {
        const q = e.quarter;
        const playerName = resolveMaybeOne(e.player);
        const tSec = parseTimeToSeconds(e.time);
        let line = "";
        if (e.type === "goal") {
          line = `${e.time || ""} doelpunt${playerName ? ` door ${playerName}` : ""}`;
          if (playerName) goalsBy.set(playerName, (goalsBy.get(playerName) || 0) + 1);
        } else if (e.type === "penalty") {
          line = `${e.time || ""} penalty veroorzaakt${playerName ? ` door ${playerName}` : ""}`;
          if (playerName) foulsBy.set(playerName, (foulsBy.get(playerName) || 0) + 1);
        } else {
          line = `${e.time || ""} persoonlijke fout${playerName ? ` door ${playerName}` : ""}`;
          if (playerName) foulsBy.set(playerName, (foulsBy.get(playerName) || 0) + 1);
        }
        grouped[q] = grouped[q] || [];
        grouped[q].push({ t: tSec, line, type: e.type, player: playerName });
      }
      for (const q of [1, 2, 3, 4]) {
        grouped[q]?.sort((a, b) => a.t - b.t);
      }

      const perQuarter = [1, 2, 3, 4]
        .map((q) => {
          const lines = (grouped[q] || []).map((ev) => `- ${ev.line}`).join("\n");
          return lines ? `Periode ${q}:\n${lines}` : `Periode ${q}: (geen opvallende gebeurtenissen)`;
        })
        .join("\n");

      const goalsStats = Array.from(goalsBy.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name}: ${count}`)
        .join(", ");
      const foulsStats = Array.from(foulsBy.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name}: ${count}`)
        .join(", ");

      const facts: string[] = [];
      if (typeof scoreHome === 'number' && typeof scoreAway === 'number') {
        facts.push(`Eindstand (letterlijk opnemen): ${scoreHome}-${scoreAway}`);
      }
      if (goalsStats) facts.push(`Doelpunten per speler (De Rijn H3): ${goalsStats}`);
      if (foulsStats) facts.push(`Persoonlijke fouten + penalties per speler (De Rijn H3): ${foulsStats}`);

      eventsForPrompt = `\nGebeurtenissen per periode (De Rijn H3):\n${perQuarter}` + (facts.length ? `\n\nFeiten:\n- ${facts.join("\n- ")}` : "");
    }
    const hasMatchData = typeof scoreHome === 'number' && typeof scoreAway === 'number' && opponent;
    
    let matchDetails = `Wedstrijd: De Rijn H3 tegen ${opponent || "onbekende tegenstander"}`;
    if (hasMatchData) {
      matchDetails += `. Eindstand: ${scoreHome}-${scoreAway}`;
      if (venue) matchDetails += `. Locatie: ${venue}`;
      if (periods?.length) matchDetails += `. Periodes: ${periods.join(', ')}`;
      if (scorers?.length) matchDetails += `. Scorers voor De Rijn: ${scorers.join(', ')}`;
      if (mvp) matchDetails += `. MVP: ${mvp}`;
      if (highlights?.length) matchDetails += `. Hoogtepunten: ${highlights.join(', ')}`;
    } else {
      matchDetails += `. Uitslag: nog niet bekend`;
    }

    const prompt = `Je bent verslaggever voor De Rijn H3 (waterpolo). Schrijf een korte, pakkende wedstrijdsamenvatting (140–220 woorden) EXCLUSIEF vanuit het perspectief van De Rijn H3.

${matchDetails}.

Strikte regels:
- Schrijf in de wij‑vorm namens De Rijn H3 ("wij", "ons") en noem de tegenstander in de derde persoon.
- Noem NOOIT namen van De Rijn H3 die niet expliciet zijn doorgegeven. Gebruik alleen namen/initialen die in de input staan bij "Scorers", "MVP" of "Highlights". Als er geen namen zijn aangeleverd, gebruik generieke bewoordingen (bijv. "onze topschutter").
- Vermijd verwarring van teamnamen; verwissel De Rijn H3 niet met de tegenstander. De teams staan bovenaan vermeld. Thuisploeg links, uitploeg rechts. De thuisploeg wordt altijd als eerste vermeld.
- Houd de toon sportief, positief en respectvol; maximaal 1–2 speelse metaforen.

Uitleg van de Sportlink-weergave (belangrijk voor interpretatie):
- Links staat THUIS (De Rijn H3), in het midden VERSLAG (overzicht van gebeurtenissen), rechts staat UIT (de tegenstander).
- Er zijn 4 periodes/kwartjes van elk 5:00. De tijd bij een gebeurtenis is de verstreken tijd binnen die periode.
- Iconen/codes:
  - Doelpunt‑icoon: een gemaakt doelpunt; de genoemde naam is de doelpuntenmaker.
  - S: penalty; de genoemde naam is de veroorzaker van de overtreding.
  - U20: persoonlijke fout (na 3 persoonlijke fouten volgt uitsluiting); de genoemde naam is de veroorzaker.
- Wanneer je scorers voor De Rijn H3 noemt, gebruik ALLEEN doelpunten uit de THUIS‑kolom (links) en koppel ze aan onze spelers; negeer doelpunten uit de UIT‑kolom.
- Noem geen spelers die niet in de aangeleverde namen/roster voorkomen.

Als er gebeurtenissen zijn aangeleverd, verwerk ze:
- Gebruik de onderstaande gebeurtenissen als leidraad voor het wedstrijdverloop (per periode) in CHRONOLOGISCHE volgorde. Geef per periode 1–3 concrete momenten met naam + tijd, en een korte analyse.
- Neem de eindstand letterlijk op in de tekst.
- Benoem doelpuntenmakers (De Rijn H3) bij naam.
- Voeg onderaan één korte regelsamenvatting toe met: "Doelpunten per speler" en "Fouten (U20+S) per speler" voor De Rijn H3.
${eventsForPrompt ? `${eventsForPrompt}` : ''}

Inhoud:
${hasMatchData ? '- Verwerk uitslag, scorers, MVP, venue en relevante wedstrijdmomenten uit de input.' : '- Geef een korte teaser met verwachtingen en focus op onze aanpak.'}
Eindig met een korte nuchtere conclusie in één zin. Schrijf in het Nederlands.`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-chat-latest",
        temperature: 0.2,
        messages: [
          { role: "system", content: "You are a sports reporter for De Rijn H3 water polo club." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: "openai_failed", info: text }, { status: 502 });
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim?.() || "";
    if (!content) return NextResponse.json({ error: "no_content" }, { status: 500 });

    const report = { content, createdAt: new Date().toISOString(), authorId: admin.userId };
    await setReport(eventId, report);
    return NextResponse.json({ ok: true, report });
  } catch (e: any) {
    return NextResponse.json({ error: "failed", message: e?.message || String(e) }, { status: 500 });
  }
}


