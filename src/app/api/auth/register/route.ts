import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import bcrypt from "bcryptjs";
import { validateRegisterInput } from "../../../../lib/validateRegisterInput";

/**
 * Registreert een gebruiker met validatie van uitnodigingscode en invoervelden.
 *
 * @param req - Inkomend registratieverzoek.
 * @returns JSON-respons met status en gebruikers-id.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "ongeldige JSON in het verzoek" },
      { status: 400 },
    );
  }

  const validation = validateRegisterInput(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const {
    email,
    trimmedFirstName,
    trimmedLastName,
    trimmedPassword,
    invitationCode,
  } = validation.data;

  // Validate invitation code
  const expectedInvitationCode = process.env.INVITATION_CODE;
  if (!expectedInvitationCode) {
    return NextResponse.json(
      { error: "uitnodigingscode is niet geconfigureerd" },
      { status: 500 },
    );
  }

  if (invitationCode.trim() !== expectedInvitationCode.trim()) {
    return NextResponse.json(
      { error: "ongeldige uitnodigingscode" },
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
