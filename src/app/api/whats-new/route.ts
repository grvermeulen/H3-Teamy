import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/authOptions";
import { prisma } from "../../../lib/db";
import { getActiveUser } from "../../../lib/activeUser";
import { APP_VERSION } from "../../../lib/version";
import { getChangelogEntry } from "../../../lib/changelog";

/**
 * Tells the client whether the What's-new tour should run for the active user.
 * Returns `show: true` when an authored changelog entry exists for the current
 * `APP_VERSION` *and* the user has not yet acked that version. Anonymous
 * visitors always get `show: false` — the tour is only meaningful for accounts
 * with persisted state.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Only show the tour to authenticated users — anon visitors don't have
    // a stable identity and shouldn't see app-update prompts.
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ show: false, version: APP_VERSION });
    }

    const { userId } = await getActiveUser(req);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lastVersionSeen: true },
    });

    const entry = getChangelogEntry(APP_VERSION);
    const show = !!entry && (user?.lastVersionSeen ?? null) !== APP_VERSION;

    return NextResponse.json({
      show,
      version: APP_VERSION,
      payload: show ? entry : undefined,
    });
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { component: "api-whats-new" } });
    return NextResponse.json({ show: false, version: APP_VERSION });
  }
}
