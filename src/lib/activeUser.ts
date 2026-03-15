import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getServerSession } from "next-auth";
import { authOptions } from "./authOptions";

export type ActiveUserResult = {
  userId: string;
  needsLink: boolean;
};

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
        });
        if (existingByEmail) {
          authUserId = existingByEmail.id;
        } else if (cookieId) {
          // Reuse or create a cookie-linked user atomically
          cookieIdentityFromAuthLookup = await prisma.identity.findUnique({
            where: {
              provider_providerUserId: {
                provider: "cookie",
                providerUserId: cookieId,
              },
            },
            select: { userId: true },
          });
          authUserId = cookieIdentityFromAuthLookup
            ? cookieIdentityFromAuthLookup.userId
            : await ensureCookieIdentityUser(cookieId);
        } else {
          const u = await prisma.user.create({
            data: { firstName: "", lastName: "" },
          });
          authUserId = u.id;
        }
      } else if (cookieId) {
        cookieIdentityFromAuthLookup = await prisma.identity.findUnique({
          where: {
            provider_providerUserId: {
              provider: "cookie",
              providerUserId: cookieId,
            },
          },
          select: { userId: true },
        });
        authUserId = cookieIdentityFromAuthLookup
          ? cookieIdentityFromAuthLookup.userId
          : await ensureCookieIdentityUser(cookieId);
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
    if (cookieId) {
      const cookieIdentity =
        cookieIdentityFromAuthLookup ||
        (await prisma.identity.findUnique({
          where: {
            provider_providerUserId: {
              provider: "cookie",
              providerUserId: cookieId,
            },
          },
          select: { userId: true },
        }));
      if (!cookieIdentity) {
        await upsertIdentity("cookie", cookieId, authUserId);
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
                  providerUserId: cookieId,
                },
              },
              create: {
                provider: "cookie",
                providerUserId: cookieId,
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
    const current = await prisma.user.findUnique({ where: { id: authUserId } });
    const updates: {
      email?: string;
      firstName?: string;
      lastName?: string;
    } = {};
    if (!current?.email && sessionEmail) {
      // Only set email if it's not used by another user already
      const other = await prisma.user.findUnique({
        where: { email: sessionEmail },
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
  if (cookieId) {
    const cookieIdentity = await prisma.identity.findUnique({
      where: {
        provider_providerUserId: {
          provider: "cookie",
          providerUserId: cookieId,
        },
      },
    });
    if (cookieIdentity)
      return { userId: cookieIdentity.userId, needsLink: false };
    const userId = await ensureCookieIdentityUser(cookieId);
    return { userId, needsLink: false };
  }
  const user = await prisma.user.create({
    data: { firstName: "", lastName: "" },
  });
  return { userId: user.id, needsLink: false };
}
