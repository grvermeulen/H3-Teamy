import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "../../../../lib/db";
import { shapeIdea } from "../../../../lib/ai/productManager";
import { buildWeeklyIdeaBlocks, postSlackBlocks } from "../../../../lib/slack";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return unauthorized();
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const ideas = await prisma.feedback.findMany({
    where: {
      type: "IDEA",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { firstName: true, lastName: true } },
    },
  });

  let processed = 0;
  for (const idea of ideas) {
    if (idea.aiSummary) continue;
    try {
      const shape = await shapeIdea({ title: idea.title, body: idea.body });
      await prisma.feedback.update({
        where: { id: idea.id },
        data: {
          aiTheme: shape.aiTheme,
          aiImpact: shape.aiImpact,
          aiSummary: shape.aiSummary,
        },
      });
      idea.aiTheme = shape.aiTheme;
      idea.aiImpact = shape.aiImpact;
      idea.aiSummary = shape.aiSummary;
      processed++;
    } catch (err) {
      Sentry.captureException(err, {
        tags: { component: "idea-weekly" },
        extra: { ideaId: idea.id },
      });
    }
  }

  const groups: Record<
    string,
    {
      title: string;
      body: string;
      aiSummary: string | null;
      aiTheme: string | null;
      aiImpact: string | null;
      user: { firstName: string; lastName: string };
    }[]
  > = {};
  for (const idea of ideas) {
    const theme = idea.aiTheme || "Unsorted";
    if (!groups[theme]) groups[theme] = [];
    groups[theme].push({
      title: idea.title,
      body: idea.body,
      aiSummary: idea.aiSummary,
      aiTheme: idea.aiTheme,
      aiImpact: idea.aiImpact,
      user: idea.user,
    });
  }

  const weekLabel = `${since.toISOString().slice(0, 10)} → ${new Date()
    .toISOString()
    .slice(0, 10)}`;
  const blocks = buildWeeklyIdeaBlocks(groups, weekLabel);
  const slack = await postSlackBlocks(blocks);

  return NextResponse.json({
    processed,
    total: ideas.length,
    posted: slack.ok,
    slackStatus: slack.status,
  });
}
