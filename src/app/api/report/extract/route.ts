import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("image") as File | null;
    if (!file) return NextResponse.json({ error: "image_required" }, { status: 400 });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "openai_key_missing" }, { status: 500 });

    const workerUrl = process.env.OCR_WORKER_URL;
    const workerToken = process.env.OCR_WORKER_TOKEN;
    if (!workerUrl || !workerToken) return NextResponse.json({ error: "ocr_worker_not_configured" }, { status: 500 });

    // 1) Call OCR Worker (EasyOCR) to get raw text
    const fd = new FormData();
    fd.append("image", file, file.name || "screenshot.png");
    const ocrResp = await fetch(`${workerUrl.replace(/\/$/, "")}/ocr`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerToken}` },
      body: fd,
    });
    if (!ocrResp.ok) {
      const info = await ocrResp.text().catch(() => "");
      return NextResponse.json({ error: "ocr_failed", info }, { status: 502 });
    }
    const ocrJson: any = await ocrResp.json().catch(() => ({} as any));
    const ocrText: string = (ocrJson?.raw_text as string | undefined) || "";

    const prompt = `Lees de wedstrijdgegevens en geef ALLEEN geldig JSON terug in exact dit schema:
{
  "homeTeam": string,
  "awayTeam": string,
  "homeScore": number,
  "awayScore": number,
  "date"?: string,
  "events": Array<{
    "quarter": 1 | 2 | 3 | 4,
    "time": string,              // mm:ss exact zoals getoond (bijv. "02:35")
    "team": "home" | "away",
    "type": "goal" | "personal_foul",
    "player"?: string
  }>
}
Regels:
- Home/away: in de header staat altijd een scoreblok "TEAM A 12-23 TEAM B". Het eerste team links (bovenaan) is altijd homeTeam; het team rechts op exact dezelfde hoogte is awayTeam. Neem de namen precies zo over zoals geschreven.
- Bepaal het kwart uit sectiekoppen zoals "1e periode", "2e periode", enz. (1..4).
- Iconen/codes: doelpunt‑icoon = "goal"; "U20" = "personal_foul".
- "team" is relatief: "home" verwijst naar homeTeam, "away" naar awayTeam (zet hier nooit teamnamen).
- Neem namen en tijden exact over; laat velden weg als ze onleesbaar zijn.
- Sorteer events eerst op "quarter" (1..4), en binnen hetzelfde kwart oplopend op "time".
- Gebruik waardes precies zoals ze in de tekst/afbeelding staan; herbereken geen scores.
- Geef uitsluitend het JSON-object terug, zonder extra tekst of toelichting.`;

    // 2) Ask LLM to normalize into our JSON schema
    const llmPayload = {
      model: "gpt-4o-2024-11-20",
      temperature: 0.1,
      messages: [
        { role: "system", content: "Je bent een nauwkeurige parser die alleen geldige JSON terugstuurt." },
        { role: "user", content: `${prompt}\n\nTekst uit OCR:\n\n\u3010BEGIN\u3011\n${ocrText}\n\u3010EINDE\u3011` },
      ],
      response_format: { type: "json_object" },
    } as const;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(llmPayload),
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
    return NextResponse.json({ result: parsed, raw_text: ocrText });
  } catch (e: any) {
    return NextResponse.json({ error: "failed", message: e?.message || String(e) }, { status: 500 });
  }
}


