import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/authOptions";
import { prisma } from "../../../../lib/db";
import { getActiveUser } from "../../../../lib/activeUser";
import { APP_VERSION } from "../../../../lib/version";

export async function POST(req: NextRequest) {
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
}
