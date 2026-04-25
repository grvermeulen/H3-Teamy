import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "../../../../lib/db";
import { isAdminUser } from "../../../../lib/trainer";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
} from "../../../../lib/schemas/feedback";
import type { FeedbackStatus, FeedbackType } from "@prisma/client";

/**
 * Admin-only listing of recent feedback rows with the submitting user attached.
 * Optional `type` and `status` query params filter the result; unknown values
 * are silently ignored. Caps the response at 200 rows.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { isAdmin } = await isAdminUser(req);
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const url = new URL(req.url);
    const typeParam = url.searchParams.get("type");
    const statusParam = url.searchParams.get("status");

    const where: {
      type?: FeedbackType;
      status?: FeedbackStatus;
    } = {};
    if (
      typeParam &&
      (FEEDBACK_TYPES as readonly string[]).includes(typeParam)
    ) {
      where.type = typeParam as FeedbackType;
    }
    if (
      statusParam &&
      (FEEDBACK_STATUSES as readonly string[]).includes(statusParam)
    ) {
      where.status = statusParam as FeedbackStatus;
    }

    const items = await prisma.feedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
    return NextResponse.json({ items });
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { component: "api-admin-feedback-get" },
    });
    return NextResponse.json({ error: "Load failed" }, { status: 500 });
  }
}
