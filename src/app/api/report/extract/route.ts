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

    // 1) Try OCR.space first for robust text extraction (free tier: 1MB limit)
    const ocrKey = process.env.OCR_SPACE_API_KEY || process.env.OCRSPACE_API_KEY;
    let ocrText: string | null = null;
    let ocrOk = false;
    if (!ocrKey) {
      // Continue without OCR (fallback to direct image parsing by LLM)
    } else if (file.size > 1_000_000) {
      // Free-tier limit reached; surface a clear error with guidance
      return NextResponse.json(
        { error: "image_too_large", message: "OCR.space free tier accepts images up to 1MB. Please upload a smaller screenshot." },
        { status: 413 }
      );
    } else {
      try {
        const fd = new FormData();
        // Prefer direct File upload for better accuracy and Edge compatibility
        fd.append("file", file, file.name || ("screenshot" + (mime.includes("png") ? ".png" : ".jpg")));
        fd.append("language", "dut"); // Dutch UI
        fd.append("isOverlayRequired", "false");
        fd.append("OCREngine", "2");
        const ocrResp = await fetch("https://api.ocr.space/parse/image", {
          method: "POST",
          headers: { apikey: ocrKey },
          body: fd,
        });
        if (ocrResp.ok) {
          const ocrJson: any = await ocrResp.json();
          const errored = ocrJson?.IsErroredOnProcessing;
          const parsed = ocrJson?.ParsedResults?.[0];
          const parsedText = parsed?.ParsedText as string | undefined;
          if (!errored && parsedText && parsedText.trim()) {
            ocrText = parsedText.trim();
            ocrOk = true;
          }
        }
      } catch {}
    }

    const prompt = `Lees de wedstrijdgegevens uit de KNZB/Sportlink app.
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

    // 2) Ask LLM to normalize into our JSON schema
    const llmPayload = ocrOk
      ? {
          // Prefer text-only when OCR succeeded
          model: "gpt-4o-2024-11-20",
          temperature: 0.1,
          messages: [
            { role: "system", content: "Je bent een nauwkeurige parser die alleen geldige JSON terugstuurt." },
            { role: "user", content: `${prompt}\n\nTekst uit OCR:\n\n\u3010BEGIN\u3011\n${ocrText}\n\u3010EINDE\u3011` },
          ],
          response_format: { type: "json_object" },
        }
      : {
          // Fallback: send the original image to the vision model
          model: "gpt-4o-2024-11-20",
          temperature: 0.1,
          messages: [
            { role: "system", content: "Je bent een nauwkeurige parser die alleen geldige JSON terugstuurt." },
            { role: "user", content: [ { type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } } ] },
          ],
          response_format: { type: "json_object" },
        };

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
    return NextResponse.json({ result: parsed });
  } catch (e: any) {
    return NextResponse.json({ error: "failed", message: e?.message || String(e) }, { status: 500 });
  }
}


