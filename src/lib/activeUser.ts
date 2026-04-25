import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { prisma } from "./db";
import { authOptions } from "./authOptions";
import { withPgConnectRetry } from "./prismaConnectRetry";
import { USER_CORE_SELECT } from "./userPrismaSelect";

export type ActiveUserResult = {
  userId: string;
  needsLink: boolean;
};

/**
 * Bepaalt hoe `anon_id` voor Identity-lookups gebruikt wordt.
 * Oude clients kregen na accountkoppeling een user-cuid in `anon_id`; dat is geen geldige
 * `providerUserId` voor `provider: "cookie"` en veroorzaakte Prisma-fouten op composite keys.
 *
 * @param raw - Ruwe cookiewaarde of `null`.
 * @returns `identityProviderUserId` voor cookie-identities, of `legacyResolvedUserId` wanneer de waarde een bestaand user-id is.
 */
async function resolveAnonCookieContext(raw: string | null): Promise<{
  identityProviderUserId: string | null;
  legacyResolvedUserId: string | null;
}> {
  if (!raw) {
    return { identityProviderUserId: null, legacyResolvedUserId: null };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { identityProviderUserId: null, legacyResolvedUserId: null };
  }
  const looksLikeRandomUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed,
    );
  if (looksLikeRandomUuid) {
    return { identityProviderUserId: trimmed, legacyResolvedUserId: null };
  }
  const userRow = await prisma.user.findUnique({
    where: { id: trimmed },
    select: { id: true },
  });
  if (userRow) {
    Sentry.addBreadcrumb({
      category: "auth",
      message: "anon_id is legacy user-id cookie; skipping cookie identity key",
      level: "info",
    });
    return { identityProviderUserId: null, legacyResolvedUserId: userRow.id };
  }
  return { identityProviderUserId: trimmed, legacyResolvedUserId: null };
}

async function resolveActiveUser(
  cookieId: string | null,
  session: Session | null,
): Promise<ActiveUserResult> {
  const { identityProviderUserId, legacyResolvedUserId } =
    await resolveAnonCookieContext(cookieId);
  async function ensureCookieIdentityUser(cookie: string): Promise<string> {
    // Create identity and user atomically; handle races by falling back to existing identity
    try {
      const created = await prisma.identity.create({
        data: {
          provider: "cookie",
          providerUserId: cookie,
          user: { create: { firstName: "", lastName: "" } },
        },
      });
      return created.userId;
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const exist = await prisma.identity.findUnique({
          where: {
            provider_providerUserId: {
              provider: "cookie",
              providerUserId: cookie,
            },
          },
          select: { userId: true },
        });
        if (exist) return exist.userId;
      }
      Sentry.captureException(error, {
        extra: {
          context: "ensureCookieIdentityUser_create",
          provider: "cookie",
        },
      });
      throw error;
    }
  }

  // Helper to upsert an identity
  async function upsertIdentity(
    provider: string,
    providerUserId: string,
    userId: string,
  ) {
    await prisma.identity.upsert({
      where: { provider_providerUserId: { provider, providerUserId } },
      create: { provider, providerUserId, userId },
      update: { userId },
    });
  }

  // If authenticated
  if (session?.user) {
    const sessionEmail = (session.user.email || "").toLowerCase();
    const provider = sessionEmail ? "email" : "auth"; // collapse credentials/google by email when present
    const sessionUserId =
      typeof (session.user as { id?: unknown }).id === "string"
        ? ((session.user as { id: string }).id || "").trim()
        : "";
    const providerUserId = sessionEmail || sessionUserId;
    if (!providerUserId) {
      const err = new Error(
        "getActiveUser: session missing stable provider id (email/id)",
      );
      Sentry.captureException(err, {
        extra: {
          context: "getActiveUser_providerUserId_missing",
          sessionUser: session.user,
        },
      });
      throw err;
    }
    let cookieIdentityFromAuthLookup: { userId: string } | null = null;

    // Find existing identity for auth
    const authIdentity = await prisma.identity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
      select: { userId: true },
    });

    let authUserId: string;
    if (authIdentity) {
      authUserId = authIdentity.userId;
    } else {
      // Prefer reusing an existing user by email (if present)
      if (sessionEmail) {
        const existingByEmail = await prisma.user.findUnique({
          where: { email: sessionEmail },
          select: USER_CORE_SELECT,
        });
        if (existingByEmail) {
          authUserId = existingByEmail.id;
        } else if (identityProviderUserId) {
          // Reuse or create a cookie-linked user atomically
          cookieIdentityFromAuthLookup = await prisma.identity.findUnique({
            where: {
              provider_providerUserId: {
                provider: "cookie",
                providerUserId: identityProviderUserId,
              },
            },
            select: { userId: true },
          });
          authUserId = cookieIdentityFromAuthLookup
            ? cookieIdentityFromAuthLookup.userId
            : await ensureCookieIdentityUser(identityProviderUserId);
        } else {
          const u = await prisma.user.create({
            data: { firstName: "", lastName: "" },
          });
          authUserId = u.id;
        }
      } else if (identityProviderUserId) {
        cookieIdentityFromAuthLookup = await prisma.identity.findUnique({
          where: {
            provider_providerUserId: {
              provider: "cookie",
              providerUserId: identityProviderUserId,
            },
          },
          select: { userId: true },
        });
        authUserId = cookieIdentityFromAuthLookup
          ? cookieIdentityFromAuthLookup.userId
          : await ensureCookieIdentityUser(identityProviderUserId);
      } else {
        const u = await prisma.user.create({
          data: { firstName: "", lastName: "" },
        });
        authUserId = u.id;
      }
      await upsertIdentity(provider, providerUserId, authUserId);
    }

    // Now consider cookie identity merge/adopt
    let needsLink = false;
    if (identityProviderUserId) {
      const cookieIdentity =
        cookieIdentityFromAuthLookup ||
        (await prisma.identity.findUnique({
          where: {
            provider_providerUserId: {
              provider: "cookie",
              providerUserId: identityProviderUserId,
            },
          },
          select: { userId: true },
        }));
      if (!cookieIdentity) {
        await upsertIdentity("cookie", identityProviderUserId, authUserId);
      } else if (cookieIdentity.userId !== authUserId) {
        // Evaluate emptiness
        const [cookieUser, rsvpCount] = await Promise.all([
          prisma.user.findUnique({
            where: { id: cookieIdentity.userId },
            select: { firstName: true, lastName: true, email: true },
          }),
          prisma.rsvp.count({ where: { userId: cookieIdentity.userId } }),
        ]);
        const hasName = !!(
          (cookieUser?.firstName || "").trim() ||
          (cookieUser?.lastName || "").trim()
        );
        const hasEmail = !!(cookieUser?.email || "").trim();
        const isEmpty = !hasName && !hasEmail && rsvpCount === 0;
        if (isEmpty) {
          // Silent adopt: repoint cookie identity and delete empty user
          await prisma.$transaction(async (tx) => {
            await tx.identity.upsert({
              where: {
                provider_providerUserId: {
                  provider: "cookie",
                  providerUserId: identityProviderUserId,
                },
              },
              create: {
                provider: "cookie",
                providerUserId: identityProviderUserId,
                userId: authUserId,
              },
              update: { userId: authUserId },
            });
            try {
              await tx.user.delete({
                where: { id: cookieIdentity.userId },
              });
            } catch (error: unknown) {
              Sentry.captureException(error, {
                extra: {
                  context: "silent_adopt_delete_empty_cookie_user",
                },
              });
            }
          });
        } else {
          needsLink = true;
        }
      }
    }

    // Hydrate missing fields from session
    const current = await prisma.user.findUnique({
      where: { id: authUserId },
      select: USER_CORE_SELECT,
    });
    const updates: {
      email?: string;
      firstName?: string;
      lastName?: string;
    } = {};
    if (!current?.email && sessionEmail) {
      // Only set email if it's not used by another user already
      const other = await prisma.user.findUnique({
        where: { email: sessionEmail },
        select: USER_CORE_SELECT,
      });
      if (!other || other.id === current?.id) {
        updates.email = sessionEmail;
      }
    }
    const sessionName = (session.user.name || "").trim();
    if (sessionName && !(current?.firstName || current?.lastName)) {
      const [fn, ...rest] = sessionName.split(" ");
      updates.firstName = updates.firstName ?? (current?.firstName || fn || "");
      updates.lastName =
        updates.lastName ?? (current?.lastName || rest.join(" ") || "");
    }
    if (Object.keys(updates).length) {
      await prisma.user.update({ where: { id: authUserId }, data: updates });
    }

    return { userId: authUserId, needsLink };
  }

  // Anonymous path
  if (legacyResolvedUserId) {
    return { userId: legacyResolvedUserId, needsLink: false };
  }
  if (identityProviderUserId) {
    const cookieIdentity = await prisma.identity.findUnique({
      where: {
        provider_providerUserId: {
          provider: "cookie",
          providerUserId: identityProviderUserId,
        },
      },
      select: { userId: true },
    });
    if (cookieIdentity)
      return { userId: cookieIdentity.userId, needsLink: false };
    const userId = await ensureCookieIdentityUser(identityProviderUserId);
    return { userId, needsLink: false };
  }
  const user = await prisma.user.create({
    data: { firstName: "", lastName: "" },
  });
  return { userId: user.id, needsLink: false };
}

/**
 * Resolves the active user for a request in authenticated and anonymous flows.
 *
 * @param req - Incoming request carrying auth session and anon cookie.
 * @returns Resolved user identifier and whether explicit account linking is required.
 */
export async function getActiveUser(
  req: NextRequest,
): Promise<ActiveUserResult> {
  const cookieId = req.cookies.get("anon_id")?.value || null;
  const session = await getServerSession(authOptions);
  return withPgConnectRetry("getActiveUser", () =>
    resolveActiveUser(cookieId, session),
  );
}
