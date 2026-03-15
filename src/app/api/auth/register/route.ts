import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/db";
import bcrypt from "bcryptjs";

const registerBodySchema = z.object({
  email: z.string().min(1, "e-mail is verplicht"),
  password: z.string().min(1, "wachtwoord is verplicht"),
  firstName: z
    .string()
    .min(1, "voornaam is verplicht")
    .refine(
      (s) => s.trim().length > 0,
      "voornaam mag niet alleen uit spaties bestaan",
    ),
  lastName: z
    .string()
    .min(1, "achternaam is verplicht")
    .refine(
      (s) => s.trim().length > 0,
      "achternaam mag niet alleen uit spaties bestaan",
    ),
  invitationCode: z.string().min(1, "uitnodigingscode is verplicht"),
});

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

  const parsed = registerBodySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors;
    const msg =
      (first.email?.[0] ||
        first.password?.[0] ||
        first.firstName?.[0] ||
        first.lastName?.[0] ||
        first.invitationCode?.[0]) ??
      "verplichte velden ontbreken of ongeldig";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const {
    email,
    password,
    firstName: rawFirstName,
    lastName: rawLastName,
    invitationCode,
  } = parsed.data;
  const trimmedFirstName = rawFirstName.trim();
  const trimmedLastName = rawLastName.trim();
  const trimmedPassword = password.trim();
  if (!trimmedPassword) {
    return NextResponse.json(
      { error: "wachtwoord mag niet alleen uit spaties bestaan" },
      { status: 400 },
    );
  }

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
