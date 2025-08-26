import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";

export async function POST(req: NextRequest) {
  const cookieUser = req.cookies.get("anon_id")?.value;
  const { firstName, lastName } = await req.json().catch(() => ({}) as any);
  if (!cookieUser) return NextResponse.json({ error: "missing" }, { status: 400 });
  await prisma.user.upsert({
    where: { id: cookieUser },
    create: { id: cookieUser, firstName: firstName || "", lastName: lastName || "" },
    update: { firstName: firstName || "", lastName: lastName || "" },
  });
  return NextResponse.json({ ok: true });
}


