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
    if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });

    // Idempotency: if a report already exists, return it
    const existing = await getReport(eventId);
    if (existing?.content) return NextResponse.json({ report: existing, reused: true });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

    const prompt = `Write a short, humorous water polo match report (120-200 words) for De Rijn H3.
Opponent: ${opponent || "unknown"}.
Final score: ${typeof scoreHome === 'number' && typeof scoreAway === 'number' ? `${scoreHome} - ${scoreAway}` : "n/a"}.
Tone: witty, light, respectful to opponents, include 1-2 playful metaphors.
Avoid profanity. Include one short standout moment.`;

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
        temperature: 0.9,
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


