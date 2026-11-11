#!/usr/bin/env -S npx tsx
/**
 * Local gateway A/B (same code, same image, OIDC as Vercel AI Gateway).
 * Usage: `VISION_AB_IMAGE=./tests/fixtures/Home-Match-1.JPG npx tsx scripts/run-vision-model-ab-once.ts openai/gpt-5.6-sol`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractReportFromImage,
  ExtractProviderError,
} from "../src/lib/reportExtractProvider";
import { getReportExtractGatewayModel } from "../src/lib/ai/gatewayModels";

const modelArg = process.argv[2] ?? "";
if (modelArg === "--help" || modelArg === "-h") {
  console.log(
    "Usage: VISION_AB_IMAGE=<path> npx tsx scripts/run-vision-model-ab-once.ts <model|default>",
  );
  process.exit(0);
}

if (
  !process.env.AI_GATEWAY_API_KEY?.trim() &&
  !process.env.VERCEL_OIDC_TOKEN?.trim()
) {
  console.error("Missing AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN");
  process.exit(2);
}

if (modelArg && modelArg !== "default") {
  process.env.REPORT_EXTRACT_OPENAI_MODEL = modelArg;
} else {
  delete process.env.REPORT_EXTRACT_OPENAI_MODEL;
}
process.env.REPORT_EXTRACT_VISION_FALLBACK_MODEL = "none";
delete process.env.REPORT_EXTRACT_PROVIDER;

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultFixture = path.join(
  repoRoot,
  "..",
  "tests",
  "fixtures",
  "Home-Match-1.JPG",
);
const img = process.env.VISION_AB_IMAGE?.trim() || defaultFixture;

async function main(): Promise<void> {
  const effectiveModel = getReportExtractGatewayModel();
  const started = Date.now();

  let buf: Buffer;
  try {
    if (!fs.existsSync(img)) {
      console.log(
        JSON.stringify(
          {
            outcome: "error",
            effectiveModel,
            code: "image_missing",
            message:
              "VISION_AB_IMAGE ontbreekt of bestand niet gevonden; geef een pad naar een test-JPEG.",
          },
          null,
          2,
        ),
      );
      process.exitCode = 2;
      return;
    }
    buf = fs.readFileSync(img);
  } catch (error: unknown) {
    console.log(
      JSON.stringify(
        {
          outcome: "error",
          effectiveModel,
          code: "image_read_failed",
          errorName: error instanceof Error ? error.name : "Error",
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }

  const file = new File([buf], "vision-ab.jpg", { type: "image/jpeg" });

  try {
    const out = await extractReportFromImage(file);
    const r = out.result;
    console.log(
      JSON.stringify(
        {
          outcome: "success",
          effectiveModel,
          fallbackUsed: out.fallbackUsed,
          latencyMs: Date.now() - started,
          homeScore: r.homeScore,
          awayScore: r.awayScore,
          eventCount: Array.isArray(r.events) ? r.events.length : 0,
        },
        null,
        2,
      ),
    );
  } catch (error: unknown) {
    const safe: Record<string, unknown> = {
      outcome: "error",
      effectiveModel,
      latencyMs: Date.now() - started,
    };
    if (error instanceof ExtractProviderError) {
      Object.assign(safe, {
        code: error.code,
        httpStatus: error.status,
        providerTelemetry: error.providerTelemetry,
        fallbackUsed: error.fallbackUsed,
        providerUsed: error.providerUsed,
      });
    } else if (error instanceof Error) {
      Object.assign(safe, {
        errorName: error.name,
        messageLength: error.message.length,
      });
    }
    console.log(JSON.stringify(safe, null, 2));
    process.exitCode = 1;
  }
}

void main();
