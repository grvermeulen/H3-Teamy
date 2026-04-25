import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/db";
import { getActiveUser } from "../../../lib/activeUser";
import { FeedbackCreateBodySchema } from "../../../lib/schemas/feedback";

export async function POST(req: NextRequest) {
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
}

export async function GET(req: NextRequest) {
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
}
