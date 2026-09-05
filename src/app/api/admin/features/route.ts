import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import {
  FEATURE_FLAGS,
  getAllFeatureFlags,
  setFeatureFlag,
  type FeatureFlagKey,
} from "../../../../lib/featureFlags";
import { isAdminUser } from "../../../../lib/trainer";
import { withDbRequestMetrics } from "../../../../lib/dbMetrics";

const FeatureFlagKeySchema = z
  .string()
  .refine((key): key is FeatureFlagKey => key in FEATURE_FLAGS, {
    message: "unknown feature flag",
  });

const PatchFeatureFlagSchema = z.object({
  key: FeatureFlagKeySchema,
  enabled: z.boolean(),
});

type PatchFeatureFlagBody = z.infer<typeof PatchFeatureFlagSchema>;

/**
 * Parses and validates the PATCH body, reporting malformed JSON to Sentry.
 *
 * @param req - The incoming PATCH request.
 * @returns The validated body, or a ready-to-return error response.
 */
async function parsePatchBody(
  req: NextRequest,
): Promise<{ data: PatchFeatureFlagBody } | { errorResponse: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { area: "admin", kind: "feature-flag-write" },
      extra: { context: "admin/features PATCH json parse" },
    });
    return {
      errorResponse: NextResponse.json(
        { error: "invalid_json", message: "Ongeldige JSON-invoer." },
        { status: 400 },
      ),
    };
  }

  const parsed = PatchFeatureFlagSchema.safeParse(body);
  if (!parsed.success) {
    return {
      errorResponse: NextResponse.json(
        {
          error: "invalid_payload",
          message: "Ongeldige invoer voor functie-instelling.",
        },
        { status: 400 },
      ),
    };
  }
  return { data: parsed.data };
}

/**
 * Returns the state of every admin-controlled feature flag.
 *
 * @param req - The incoming request; only admins may read the flags.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return withDbRequestMetrics("api/admin/features.GET", async () => {
    const { isAdmin } = await isAdminUser(req);
    if (!isAdmin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const flags = await getAllFeatureFlags();
    return NextResponse.json({ flags });
  });
}

/**
 * Updates one admin-controlled feature flag and returns the resulting state of all flags.
 *
 * @param req - The incoming request; body is `{ key: FeatureFlagKey; enabled: boolean }`.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  return withDbRequestMetrics("api/admin/features.PATCH", async () => {
    const { isAdmin, me } = await isAdminUser(req);
    if (!isAdmin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const parsedBody = await parsePatchBody(req);
    if ("errorResponse" in parsedBody) return parsedBody.errorResponse;

    try {
      await setFeatureFlag(parsedBody.data.key, parsedBody.data.enabled, me.id);
    } catch (error: unknown) {
      const eventId = Sentry.captureException(error, {
        tags: { area: "admin", kind: "feature-flag-write" },
      });
      return NextResponse.json(
        {
          error: "feature_flag_write_failed",
          message: "Opslaan van de functie-instelling is mislukt.",
          eventId,
        },
        { status: 500 },
      );
    }

    const flags = await getAllFeatureFlags();
    return NextResponse.json({ flags });
  });
}
