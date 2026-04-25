import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "../../../lib/db";
import { getActiveUser } from "../../../lib/activeUser";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../lib/dbUnavailableError";
import { USER_CORE_SELECT } from "../../../lib/userPrismaSelect";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getActiveUser(req);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: USER_CORE_SELECT,
    });
    if (!user) return NextResponse.json({ user: null });
    return NextResponse.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email || "",
      },
    });
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Er ging iets mis" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await getActiveUser(req);
    const { firstName, lastName, email } = await req
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    if (!firstName || !lastName)
      return NextResponse.json(
        { error: "firstName and lastName required" },
        { status: 400 },
      );

    // Validate non-empty strings (trimmed)
    const trimmedFirstName = String(firstName).trim();
    const trimmedLastName = String(lastName).trim();

    if (!trimmedFirstName || !trimmedLastName) {
      return NextResponse.json(
        { error: "firstName and lastName cannot be empty" },
        { status: 400 },
      );
    }

    const data: {
      firstName: string;
      lastName: string;
      email?: string;
    } = { firstName: trimmedFirstName, lastName: trimmedLastName };
    if (email && typeof email === "string")
      data.email = email.toLowerCase().trim();
    try {
      await prisma.user.update({ where: { id: userId }, data });
      if (data.email) {
        await prisma.identity.upsert({
          where: {
            provider_providerUserId: {
              provider: "email",
              providerUserId: data.email,
            },
          },
          create: { provider: "email", providerUserId: data.email, userId },
          update: { userId },
        });
      }
      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      const code =
        e && typeof e === "object" && "code" in e
          ? String((e as { code?: string }).code)
          : "";
      if (code === "P2002") {
        return NextResponse.json(
          { error: "E-mailadres is al in gebruik" },
          { status: 409 },
        );
      }
      Sentry.captureException(e);
      return NextResponse.json(
        { error: "Opslaan is mislukt" },
        { status: 500 },
      );
    }
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) {
      return jsonDatabaseUnavailable();
    }
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Er ging iets mis" },
      { status: 500 },
    );
  }
}
