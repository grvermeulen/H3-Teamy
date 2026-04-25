import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { isAdminUser } from "../../../../lib/trainer";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
} from "../../../../lib/schemas/feedback";
import type { FeedbackStatus, FeedbackType } from "@prisma/client";

export async function GET(req: NextRequest) {
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
  if (typeParam && (FEEDBACK_TYPES as readonly string[]).includes(typeParam)) {
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
}
