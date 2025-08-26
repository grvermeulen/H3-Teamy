import { NextRequest } from "next/server";
import { prisma } from "./db";
import { getServerSession } from "next-auth";
import { authOptions } from "./authOptions";

export type ActiveUserResult = {
  userId: string;
  needsLink: boolean;
};

export async function getActiveUser(req: NextRequest): Promise<ActiveUserResult> {
  const cookieId = req.cookies.get("anon_id")?.value || null;
  const session: any = await getServerSession(authOptions as any);

  async function ensureCookieIdentityUser(cookie: string): Promise<string> {
    // Create identity and user atomically; handle races by falling back to existing identity
    try {
      const created = await prisma.identity.create({
        data: {
          provider: "cookie",
          providerUserId: cookie,
          user: { create: { firstName: "", lastName: "" } },
        },
        include: { user: true },
      });
      return created.userId;
    } catch (e: any) {
      if (e?.code === "P2002") {
        const exist = await prisma.identity.findUnique({ where: { provider_providerUserId: { provider: "cookie", providerUserId: cookie } } });
        if (exist) return exist.userId;
      }
      // Fallback: create bare user and upsert identity
      const u = await prisma.user.create({ data: { firstName: "", lastName: "" } });
      await prisma.identity.upsert({
        where: { provider_providerUserId: { provider: "cookie", providerUserId: cookie } },
        create: { provider: "cookie", providerUserId: cookie, userId: u.id },
        update: {},
      });
      return u.id;
    }
  }

  // Helper to upsert an identity
  async function upsertIdentity(provider: string, providerUserId: string, userId: string) {
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
    const providerUserId = sessionEmail || (session.user.name || "");

    // Find existing identity for auth
    const authIdentity = await prisma.identity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
      include: { user: true },
    });

    let authUserId: string;
    if (authIdentity) {
      authUserId = authIdentity.userId;
    } else {
      // Prefer reusing an existing user by email (if present)
      if (sessionEmail) {
        const existingByEmail = await prisma.user.findUnique({ where: { email: sessionEmail } });
        if (existingByEmail) {
          authUserId = existingByEmail.id;
        } else if (cookieId) {
          // Reuse or create a cookie-linked user atomically
          const cookieIdentity = await prisma.identity.findUnique({ where: { provider_providerUserId: { provider: "cookie", providerUserId: cookieId } } });
          authUserId = cookieIdentity ? cookieIdentity.userId : await ensureCookieIdentityUser(cookieId);
        } else {
          const u = await prisma.user.create({ data: { firstName: "", lastName: "" } });
          authUserId = u.id;
        }
      } else if (cookieId) {
        const cookieIdentity = await prisma.identity.findUnique({ where: { provider_providerUserId: { provider: "cookie", providerUserId: cookieId } } });
        authUserId = cookieIdentity ? cookieIdentity.userId : await ensureCookieIdentityUser(cookieId);
      } else {
        const u = await prisma.user.create({ data: { firstName: "", lastName: "" } });
        authUserId = u.id;
      }
      await upsertIdentity(provider, providerUserId, authUserId);
    }

    // Now consider cookie identity merge/adopt
    let needsLink = false;
    if (cookieId) {
      const cookieIdentity = await prisma.identity.findUnique({ where: { provider_providerUserId: { provider: "cookie", providerUserId: cookieId } }, include: { user: true } });
      if (!cookieIdentity) {
        await upsertIdentity("cookie", cookieId, authUserId);
      } else if (cookieIdentity.userId !== authUserId) {
        // Evaluate emptiness
        const cookieUser = cookieIdentity.user;
        const hasName = !!((cookieUser.firstName || "").trim() || (cookieUser.lastName || "").trim());
        const hasEmail = !!(cookieUser.email || "").trim();
        const rsvpCount = await prisma.rsvp.count({ where: { userId: cookieIdentity.userId } });
        const isEmpty = !hasName && !hasEmail && rsvpCount === 0;
        if (isEmpty) {
          // Silent adopt: repoint cookie identity and delete empty user
          await prisma.$transaction([
            prisma.identity.upsert({
              where: { provider_providerUserId: { provider: "cookie", providerUserId: cookieId } },
              create: { provider: "cookie", providerUserId: cookieId, userId: authUserId },
              update: { userId: authUserId },
            }),
            prisma.user.delete({ where: { id: cookieIdentity.userId } }).catch(() => null as any),
          ] as any);
        } else {
          needsLink = true;
        }
      }
    }

    // Hydrate missing fields from session
    const current = await prisma.user.findUnique({ where: { id: authUserId } });
    const updates: any = {};
    if (!current?.email && sessionEmail) {
      // Only set email if it's not used by another user already
      const other = await prisma.user.findUnique({ where: { email: sessionEmail } });
      if (!other || other.id === current?.id) {
        updates.email = sessionEmail;
      }
    }
    const sessionName = (session.user.name || "").trim();
    if (sessionName && !(current?.firstName || current?.lastName)) {
      const [fn, ...rest] = sessionName.split(" ");
      updates.firstName = updates.firstName ?? (current?.firstName || fn || "");
      updates.lastName = updates.lastName ?? (current?.lastName || rest.join(" ") || "");
    }
    if (Object.keys(updates).length) {
      await prisma.user.update({ where: { id: authUserId }, data: updates });
    }

    return { userId: authUserId, needsLink };
  }

  // Anonymous path
  if (cookieId) {
    const cookieIdentity = await prisma.identity.findUnique({ where: { provider_providerUserId: { provider: "cookie", providerUserId: cookieId } } });
    if (cookieIdentity) return { userId: cookieIdentity.userId, needsLink: false };
    const userId = await ensureCookieIdentityUser(cookieId);
    return { userId, needsLink: false };
  }
  const user = await prisma.user.create({ data: { firstName: "", lastName: "" } });
  return { userId: user.id, needsLink: false };
}
