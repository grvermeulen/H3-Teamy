import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import bcrypt from "bcryptjs";
import { redeemPasswordResetToken } from "../../../../../lib/kv";

export async function POST(req: Request) {
  try {
    const { token, password } = await req.json();
    if (!token || typeof token !== "string" || !password || typeof password !== "string") {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }
    const userId = await redeemPasswordResetToken(token);
    if (!userId) return NextResponse.json({ ok: false, error: "Invalid or expired token" }, { status: 400 });
    const hash = await bcrypt.genSalt(10).then((s) => bcrypt.hash(password, s));
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}


