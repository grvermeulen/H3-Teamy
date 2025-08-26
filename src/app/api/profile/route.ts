import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/db";
import { getActiveUser } from "../../../lib/activeUser";

export async function GET(req: NextRequest) {
  const { userId } = await getActiveUser(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({ user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email || "" } });
}

export async function POST(req: NextRequest) {
  const { userId } = await getActiveUser(req);
  const { firstName, lastName, email } = await req.json().catch(() => ({} as any));
  if (!firstName || !lastName) return NextResponse.json({ error: "firstName and lastName required" }, { status: 400 });
  const data: any = { firstName, lastName };
  if (email && typeof email === "string") data.email = email.toLowerCase();
  try {
    await prisma.user.update({ where: { id: userId }, data });
    if (data.email) {
      await prisma.identity.upsert({
        where: { provider_providerUserId: { provider: "email", providerUserId: data.email } },
        create: { provider: "email", providerUserId: data.email, userId },
        update: { userId },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}


