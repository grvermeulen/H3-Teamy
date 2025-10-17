import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import { createPasswordResetToken } from "../../../../../lib/kv";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") return NextResponse.json({ ok: true });
    const user = await prisma.user.findFirst({ where: { email } });
    if (!user) return NextResponse.json({ ok: true });
    const token = await createPasswordResetToken(user.id);
    // In production, send email here. For now, return the token for manual use.
    return NextResponse.json({ ok: true, token });
  } catch {
    return NextResponse.json({ ok: true });
  }
}


