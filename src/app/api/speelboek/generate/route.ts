import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { generateSpeelboekDrillFromDescription } from "@/lib/ai/speelboekGenerate";
import { isTrainer } from "@/lib/trainer";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  description: z.string().trim().min(10).max(4000),
});

/**
 * Generates a speelboek drill draft from trainer text (structured AI output).
 * Trainers only; returns a partial drill without id/addedOn for editor review.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { isTrainer: ok } = await isTrainer(req);
    if (!ok) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ongeldige invoer", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const draft = await generateSpeelboekDrillFromDescription(
      parsed.data.description,
    );
    return NextResponse.json({ draft });
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { module: "speelboek_generate", operation: "generateObject" },
    });
    return NextResponse.json(
      { error: "Genereren mislukt" },
      { status: 502 },
    );
  }
}
