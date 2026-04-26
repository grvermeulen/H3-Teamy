import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "../../../lib/db";
import { getActiveUser } from "../../../lib/activeUser";
import { FeedbackCreateBodySchema } from "../../../lib/schemas/feedback";

/**
 * Creates a new `Feedback` row (BUG or IDEA) for the active user. Validates
 * the body against `FeedbackCreateBodySchema`; returns `400` on shape errors.
 * Captures the user-agent server-side so admins can see which client filed the
 * report.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await getActiveUser(req);
    const json = await req.json().catch(() => null);
    const parsed = FeedbackCreateBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { type, title, body, route, appVersion } = parsed.data;
    const userAgent = (req.headers.get("user-agent") || "").slice(0, 500);

    const created = await prisma.feedback.create({
      data: {
        userId,
        type,
        title,
        body,
        route,
        appVersion,
        userAgent,
      },
      select: { id: true },
    });
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { component: "api-feedback-post" } });
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}

/**
 * Returns up to 50 of the active user's own feedback submissions. Requires
 * `?mine=true` so this endpoint cannot accidentally leak other users' rows;
 * admin listing lives at `/api/admin/feedback`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await getActiveUser(req);
    const url = new URL(req.url);
    if (url.searchParams.get("mine") !== "true") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const items = await prisma.feedback.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ items });
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { component: "api-feedback-get" } });
    return NextResponse.json({ error: "Load failed" }, { status: 500 });
  }
}
