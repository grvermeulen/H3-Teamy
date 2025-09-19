import { NextRequest, NextResponse } from "next/server";
import { getReport, setReport } from "../../../../lib/kv";
import { getActiveUser } from "../../../../lib/activeUser";
import { prisma } from "../../../../lib/db";

function isAdminName(a: string | undefined, b: string) {
  const na = (a || "").toLowerCase().trim();
  const nb = (b || "").toLowerCase().trim();
  return na === nb;
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
    const scorers = body?.scorers as string[] | undefined;
    const mvp = body?.mvp as string | undefined;
    const periods = body?.periods as (number | string)[] | undefined;
    const highlights = body?.highlights as string[] | undefined;
    if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });

    // Always (re)generate a fresh report on request

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

    // Build detailed match info for the prompt
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

    const prompt = `Schrijf een korte, humoristische wedstrijdsamenvatting (120–200 woorden) voor De Rijn H3 waterpolo.

${matchDetails}.

Stijl: luchtig, geestig en sportief naar de tegenstander. Gebruik 1–2 speelse metaforen. 
${hasMatchData ? 'Beschrijf de wedstrijd op basis van de uitslag en gebruik de beschikbare details (scorers, MVP, etc.) om een levendig verhaal te maken.' : 'Geef een korte teaser van wat er misschien gaat komen op basis van eerdere wedstrijden.'}
Schrijf in het Nederlands.`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
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


