import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/authOptions";
import { prisma } from "../../../lib/db";
import { getActiveUser } from "../../../lib/activeUser";
import { APP_VERSION } from "../../../lib/version";
import { getChangelogEntry } from "../../../lib/changelog";

export async function GET(req: NextRequest) {
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
}
