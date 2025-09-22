import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("image") as File | null;
    if (!file) return NextResponse.json({ error: "image_required" }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "image/png";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "openai_key_missing" }, { status: 500 });

    const prompt = `Lees de wedstrijdgegevens uit deze screenshot van de KNZB/Sportlink app.
Geef uitsluitend JSON met velden:
{
  "homeTeam": string,
  "awayTeam": string,
  "homeScore": number,
  "awayScore": number,
  "venue"?: string,
  "date"?: string,
  "periods"?: number[] | string[],
  "highlights"?: string[],
  "scorers"?: string[],
  "mvp"?: string,
  "keeperSaves"?: number,
  "cards"?: string[],
  "events"?: Array<{
    "quarter": 1 | 2 | 3 | 4,
    "time"?: string,              // tijd binnen de periode, zoals getoond (bijv. "02:35")
    "team": "home" | "away",    // THUIS = home (links), UIT = away (rechts)
    "type": "goal" | "penalty" | "personal_foul",
    "player"?: string             // weergegeven naam naast de gebeurtenis
  }>
}
Regels voor events:
- Een sectiekop zoals "1e periode" duidt het kwart aan; gebruik dit om "quarter" te bepalen (1..4).
- Iconen/codes: doelpunt‑icoon = "goal"; "S" = "penalty" (genoemde speler veroorzaakte de penalty); "U20" = "personal_foul" (persoonlijke fout).
- Bepaal het team uit de kolom: links (THUIS) -> "home"; rechts (UIT) -> "away".
- Sorteer events binnen hetzelfde kwart oplopend op tijd.
Laat onbekende velden weg. Geef alleen geldige JSON terug.`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-2024-11-20",
        temperature: 0.1,
        messages: [
          { role: "system", content: "Je bent een nauwkeurige parser die alleen geldige JSON terugstuurt." },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) {
      const info = await resp.text();
      return NextResponse.json({ error: "openai_failed", info }, { status: 502 });
    }
    const data = await resp.json();
    let parsed: any = {};
    try {
      const content = data?.choices?.[0]?.message?.content || "{}";
      parsed = JSON.parse(content);
    } catch {}
    return NextResponse.json({ result: parsed });
  } catch (e: any) {
    return NextResponse.json({ error: "failed", message: e?.message || String(e) }, { status: 500 });
  }
}


