import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  extractReportFromImage,
  ExtractProviderError,
} from "../../../../lib/reportExtractProvider";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const form = await req.formData();
    const file = form.get("image") as File | null;
    if (!file)
      return NextResponse.json({ error: "image_required" }, { status: 400 });

    const extracted = await extractReportFromImage(file);

    console.info("report_extract_completed", {
      providerUsed: extracted.providerUsed,
      model: extracted.model,
      fallbackUsed: extracted.fallbackUsed,
      latencyMs: extracted.latencyMs,
    });

    return NextResponse.json({
      result: extracted.result,
      raw_text: extracted.rawText,
    });
  } catch (error: unknown) {
    const latencyMs = Date.now() - startedAt;
    if (error instanceof ExtractProviderError) {
      Sentry.captureException(error, {
        tags: {
          module: "report_extract",
          provider: error.providerUsed || error.provider || "unknown",
          operation: "extract",
        },
        extra: {
          code: error.code,
          status: error.status,
          info: error.info,
          model: error.model,
          fallbackUsed: error.fallbackUsed,
          latencyMs,
        },
      });
      return NextResponse.json(
        { error: error.code, message: error.message, info: error.info },
        { status: error.status },
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      tags: { module: "report_extract", operation: "extract" },
      extra: { latencyMs },
    });
    return NextResponse.json({ error: "failed", message }, { status: 500 });
  }
}
