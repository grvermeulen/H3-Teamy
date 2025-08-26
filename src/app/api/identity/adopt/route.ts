import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { getActiveUser } from "../../../../lib/activeUser";

export async function POST(req: NextRequest) {
  const cookieId = req.cookies.get("anon_id")?.value || null;
  if (!cookieId) return NextResponse.json({ error: "no cookie" }, { status: 400 });
  const { userId } = await getActiveUser(req);
  const cookieIdentity = await prisma.identity.findUnique({ where: { provider_providerUserId: { provider: "cookie", providerUserId: cookieId } }, include: { user: true } });
  if (!cookieIdentity || cookieIdentity.userId === userId) return NextResponse.json({ ok: true });

  // Move RSVPs and repoint identity transactionally
  await prisma.$transaction(async (tx) => {
    await tx.rsvp.updateMany({ where: { userId: cookieIdentity.userId }, data: { userId } });
    await tx.identity.upsert({ where: { provider_providerUserId: { provider: "cookie", providerUserId: cookieId } }, create: { provider: "cookie", providerUserId: cookieId, userId }, update: { userId } });
    // Delete cookie user if no identities remain
    const left = await tx.identity.count({ where: { userId: cookieIdentity.userId } });
    if (left === 0) {
      await tx.user.delete({ where: { id: cookieIdentity.userId } }).catch(() => null as any);
    }
  });

  return NextResponse.json({ ok: true });
}
