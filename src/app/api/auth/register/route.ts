import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const { email, password, firstName, lastName, invitationCode } =
    await req.json();

  // Validate required fields
  if (!email || !password || !firstName || !lastName) {
    return NextResponse.json({ error: "missing" }, { status: 400 });
  }

  // Validate non-empty strings (trimmed)
  const trimmedFirstName = firstName.trim();
  const trimmedLastName = lastName.trim();
  const trimmedPassword = password.trim();

  if (!trimmedFirstName || !trimmedLastName || !trimmedPassword) {
    return NextResponse.json(
      { error: "firstName, lastName, and password cannot be empty" },
      { status: 400 },
    );
  }

  // Validate invitation code
  const expectedInvitationCode = process.env.INVITATION_CODE;
  if (!expectedInvitationCode) {
    return NextResponse.json(
      { error: "invitation code not configured" },
      { status: 500 },
    );
  }

  if (
    !invitationCode ||
    invitationCode.trim() !== expectedInvitationCode.trim()
  ) {
    return NextResponse.json(
      { error: "invalid invitation code" },
      { status: 403 },
    );
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (existing) {
    return NextResponse.json(
      { error: "account bestaat al, gebruik wachtwoord vergeten" },
      { status: 409 },
    );
  }

  const hash = await bcrypt.hash(trimmedPassword, 10);
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash: hash,
      firstName: trimmedFirstName,
      lastName: trimmedLastName,
      id: crypto.randomUUID(),
    },
  });
  return NextResponse.json({ ok: true, id: user.id });
}
