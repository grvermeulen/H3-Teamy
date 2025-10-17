import { NextRequest, NextResponse } from "next/server";
import { setReport } from "../../../../lib/kv";

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
    const prompt = `Je krijgt JSON met wedstrijdgegevens. Schrijf een korte, energieke wedstrijdsamenvatting (140–220 woorden) in het Nederlands, vanuit het perspectief van De Rijn Heren 3 ("wij/ons").

Regels:
- Gebruik uitsluitend de informatie uit de JSON. Geen extra bronnen of controles.
- Noem doelpuntenmakers van De Rijn Heren 3 expliciet bij naam op basis van events (type "goal" en team "home").
- Sluit af met de eindstand (homeScore-awayScore) en benoem kort een De Rijn Heren 3 MVP op basis van de events.
- Houd het sportief, positief en enthousiast; maximaal 2 uitroeptekens.
- Bovenaan de JSON staat uitgelegd welk team "home" is en welk team "away" is.


JSON:
${JSON.stringify(input, null, 2)}
`;

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
          { role: "system", content: "You are an enthusiastic, pro–De Rijn Heren 3 reporter. Write energetic, respectful Dutch match reports using only the provided JSON." },
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

    const report = { content, createdAt: new Date().toISOString() };
    await setReport(eventId, report);
    return NextResponse.json({ ok: true, report });
  } catch (e: any) {
    return NextResponse.json({ error: "failed", message: e?.message || String(e) }, { status: 500 });
  }
}


