import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/authOptions";
import { prisma } from "../../../../lib/db";
import { getActiveUser } from "../../../../lib/activeUser";
import { APP_VERSION } from "../../../../lib/version";

/**
 * Records that the active user has seen the What's-new tour for the current
 * `APP_VERSION` by setting `User.lastVersionSeen`, so the tour will not appear
 * again until the next release with a changelog entry.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    const { userId } = await getActiveUser(req);
    await prisma.user.update({
      where: { id: userId },
      data: { lastVersionSeen: APP_VERSION },
    });
    return NextResponse.json({ ok: true, version: APP_VERSION });
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { component: "api-whats-new-ack" } });
    return NextResponse.json(
      { ok: false, error: "Ack failed" },
      { status: 500 },
    );
  }
}
