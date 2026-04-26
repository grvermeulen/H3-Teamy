import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../../lib/db";
import { isAdminUser } from "../../../../../lib/trainer";
import { FeedbackStatusUpdateBodySchema } from "../../../../../lib/schemas/feedback";

/**
 * Admin-only status update for a single feedback row. Distinguishes the
 * "row not found" case (Prisma `P2025` → 404) from any other failure, which is
 * reported to Sentry and surfaces as a generic 500.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { isAdmin } = await isAdminUser(req);
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const json = await req.json().catch(() => null);
    const parsed = FeedbackStatusUpdateBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    try {
      const updated = await prisma.feedback.update({
        where: { id },
        data: { status: parsed.data.status },
        select: { id: true, status: true },
      });
      return NextResponse.json(updated);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      throw err;
    }
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { component: "api-admin-feedback-patch" },
    });
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
