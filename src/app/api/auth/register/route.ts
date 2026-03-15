import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";

const RegisterBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().trim().min(1),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
});

/**
 * Registreert een gebruiker via e-mail/wachtwoord en updatet bestaande accounts idempotent.
 * @param req - Inkomend registratieverzoek.
 * @returns JSON-response met resultaat en user-id.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Ongeldige JSON-invoer." },
      { status: 400 },
    );
  }

  const parsed = RegisterBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", message: "Ongeldige registratiegegevens." },
      { status: 400 },
    );
  }

  const { email, password, firstName, lastName } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  try {
    return await Sentry.startSpan(
      { op: "db.query", name: "POST /api/auth/register upsert user" },
      async () => {
        const hash = await bcrypt.hash(password, 10);
        const user = await prisma.user.upsert({
          where: { email: normalizedEmail },
          update: { passwordHash: hash, firstName, lastName },
          create: {
            email: normalizedEmail,
            passwordHash: hash,
            firstName,
            lastName,
            id: crypto.randomUUID(),
          },
        });
        return NextResponse.json({ ok: true, id: user.id });
      },
    );
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error: "email_al_in_gebruik",
          message: "Dit e-mailadres is al in gebruik.",
        },
        { status: 409 },
      );
    }
    const eventId = Sentry.captureException(error, {
      extra: { context: "auth_register_post" },
    });
    return NextResponse.json(
      {
        error: "registratie_mislukt",
        message: "Registreren is mislukt. Probeer het opnieuw.",
        eventId,
      },
      { status: 500 },
    );
  }
}


