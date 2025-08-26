import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const { email, password, firstName, lastName } = await req.json();
  if (!email || !password || !firstName || !lastName) return NextResponse.json({ error: "missing" }, { status: 400 });
  const hash = await bcrypt.hash(password, 10);
  // If a user exists with this email, update password; else create new
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, firstName, lastName },
    create: { email, passwordHash: hash, firstName, lastName, id: crypto.randomUUID() },
  });
  return NextResponse.json({ ok: true, id: user.id });
}


