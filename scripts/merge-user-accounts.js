/*
  One-off script to merge a secondary user account into a primary account.

  Usage:
    node scripts/merge-user-accounts.js --primary-email henryturkenburg@gmail.com
    node scripts/merge-user-accounts.js --primary-email henryturkenburg@gmail.com --secondary-id <USER_ID>
    node scripts/merge-user-accounts.js --primary-email henryturkenburg@gmail.com --secondary-email other@example.com
    node scripts/merge-user-accounts.js --primary-email henryturkenburg@gmail.com --dry-run
*/

const fs = require("fs");
const path = require("path");
const { PrismaClient, Prisma } = require("@prisma/client");

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const val = process.argv[idx + 1];
  if (!val || val.startsWith("--")) return null;
  return val;
}

function norm(s) {
  return (s || "").toLowerCase().trim();
}

function getDatabaseUrl() {
  const envUrl = (process.env.DATABASE_URL || "").trim();
  if (envUrl) return envUrl;
  const prismaUrl = (process.env.PRISMA_DATABASE_URL || "").trim();
  if (prismaUrl) return prismaUrl;
  try {
    const fileUrl = fs
      .readFileSync(path.join(process.cwd(), "prisma_url.txt"), "utf-8")
      .trim();
    return fileUrl || "";
  } catch {
    return "";
  }
}

async function loadPrimaryUser(prisma, primaryEmail) {
  return prisma.user.findFirst({
    where: { email: { equals: primaryEmail, mode: "insensitive" } },
  });
}

async function findSecondaryUser(
  prisma,
  primaryUser,
  secondaryId,
  secondaryEmail,
) {
  if (secondaryId) {
    return prisma.user.findUnique({ where: { id: secondaryId } });
  }
  if (secondaryEmail) {
    return prisma.user.findFirst({
      where: { email: { equals: secondaryEmail, mode: "insensitive" } },
    });
  }
  const full =
    `${norm(primaryUser.firstName)} ${norm(primaryUser.lastName)}`.trim();
  if (!full) return null;
  const matches = await prisma.user.findMany({
    where: {
      id: { not: primaryUser.id },
      firstName: { equals: primaryUser.firstName, mode: "insensitive" },
      lastName: { equals: primaryUser.lastName, mode: "insensitive" },
    },
  });
  if (matches.length !== 1) {
    return { __candidates: matches };
  }
  return matches[0];
}

async function mergeUsers(prisma, primary, secondary, dryRun) {
  if (dryRun) {
    console.log("Dry run: no changes will be written.");
  }

  const summary = {
    rsvpsMoved: 0,
    rsvpsDeleted: 0,
    attendanceMoved: 0,
    attendanceDeleted: 0,
    identitiesMoved: 0,
    identitiesDeleted: 0,
    linkCodesMoved: 0,
    attendanceMarkersUpdated: 0,
    matchReportsUpdated: 0,
    mvpVotesUpdated: 0,
  };

  const tx = prisma;
  const action = async () => {
    const primaryRsvps = await tx.rsvp.findMany({
      where: { userId: primary.id },
      select: { eventId: true },
    });
    const primaryRsvpEvents = new Set(primaryRsvps.map((r) => r.eventId));
    const secondaryRsvps = await tx.rsvp.findMany({
      where: { userId: secondary.id },
    });
    for (const rsvp of secondaryRsvps) {
      if (primaryRsvpEvents.has(rsvp.eventId)) {
        if (!dryRun) {
          await tx.rsvp.delete({
            where: {
              userId_eventId: { userId: secondary.id, eventId: rsvp.eventId },
            },
          });
        }
        summary.rsvpsDeleted += 1;
      } else {
        if (!dryRun) {
          await tx.rsvp.update({
            where: {
              userId_eventId: { userId: secondary.id, eventId: rsvp.eventId },
            },
            data: { userId: primary.id },
          });
        }
        summary.rsvpsMoved += 1;
      }
    }

    const primaryAttendance = await tx.attendance.findMany({
      where: { userId: primary.id },
      select: { date: true },
    });
    const primaryAttendanceDates = new Set(
      primaryAttendance.map((a) => a.date),
    );
    const secondaryAttendance = await tx.attendance.findMany({
      where: { userId: secondary.id },
    });
    for (const att of secondaryAttendance) {
      if (primaryAttendanceDates.has(att.date)) {
        if (!dryRun) {
          await tx.attendance.delete({
            where: { date_userId: { date: att.date, userId: secondary.id } },
          });
        }
        summary.attendanceDeleted += 1;
      } else {
        if (!dryRun) {
          await tx.attendance.update({
            where: { date_userId: { date: att.date, userId: secondary.id } },
            data: { userId: primary.id },
          });
        }
        summary.attendanceMoved += 1;
      }
    }

    const primaryIdentities = await tx.identity.findMany({
      where: { userId: primary.id },
      select: { provider: true, providerUserId: true },
    });
    const primaryIdentityKeys = new Set(
      primaryIdentities.map((i) => `${i.provider}::${i.providerUserId}`),
    );
    const secondaryIdentities = await tx.identity.findMany({
      where: { userId: secondary.id },
    });
    for (const ident of secondaryIdentities) {
      const key = `${ident.provider}::${ident.providerUserId}`;
      if (primaryIdentityKeys.has(key)) {
        if (!dryRun) {
          await tx.identity.delete({ where: { id: ident.id } });
        }
        summary.identitiesDeleted += 1;
      } else {
        if (!dryRun) {
          await tx.identity.update({
            where: { id: ident.id },
            data: { userId: primary.id },
          });
        }
        summary.identitiesMoved += 1;
      }
    }

    if (!dryRun) {
      const linkCodes = await tx.linkCode.updateMany({
        where: { userId: secondary.id },
        data: { userId: primary.id },
      });
      summary.linkCodesMoved += linkCodes.count;
    } else {
      const count = await tx.linkCode.count({
        where: { userId: secondary.id },
      });
      summary.linkCodesMoved += count;
    }

    if (!dryRun) {
      const attendanceMarker = await tx.attendance.updateMany({
        where: { markedBy: secondary.id },
        data: { markedBy: primary.id },
      });
      summary.attendanceMarkersUpdated += attendanceMarker.count;
    } else {
      const count = await tx.attendance.count({
        where: { markedBy: secondary.id },
      });
      summary.attendanceMarkersUpdated += count;
    }

    try {
      if (!dryRun) {
        const res = await tx.$executeRaw(
          Prisma.sql`UPDATE "MatchReport" SET "authorId" = ${primary.id} WHERE "authorId" = ${secondary.id}`,
        );
        summary.matchReportsUpdated += Number(res || 0);
      } else {
        const res = await tx.$queryRaw(
          Prisma.sql`SELECT COUNT(*)::int AS count FROM "MatchReport" WHERE "authorId" = ${secondary.id}`,
        );
        summary.matchReportsUpdated += Array.isArray(res)
          ? Number(res[0]?.count || 0)
          : 0;
      }
    } catch {}

    try {
      if (!dryRun) {
        const resVoter = await tx.$executeRaw(
          Prisma.sql`UPDATE "MvpVote" SET "voterId" = ${primary.id} WHERE "voterId" = ${secondary.id}`,
        );
        const resCandidate = await tx.$executeRaw(
          Prisma.sql`UPDATE "MvpVote" SET "candidateId" = ${primary.id} WHERE "candidateId" = ${secondary.id}`,
        );
        summary.mvpVotesUpdated +=
          Number(resVoter || 0) + Number(resCandidate || 0);
      } else {
        const resVoter = await tx.$queryRaw(
          Prisma.sql`SELECT COUNT(*)::int AS count FROM "MvpVote" WHERE "voterId" = ${secondary.id}`,
        );
        const resCandidate = await tx.$queryRaw(
          Prisma.sql`SELECT COUNT(*)::int AS count FROM "MvpVote" WHERE "candidateId" = ${secondary.id}`,
        );
        const voterCount = Array.isArray(resVoter)
          ? Number(resVoter[0]?.count || 0)
          : 0;
        const candidateCount = Array.isArray(resCandidate)
          ? Number(resCandidate[0]?.count || 0)
          : 0;
        summary.mvpVotesUpdated += voterCount + candidateCount;
      }
    } catch {}

    if (!dryRun) {
      await tx.user.delete({ where: { id: secondary.id } });
    }
  };

  await action();

  return summary;
}

async function main() {
  const primaryEmail =
    getArgValue("--primary-email") || process.env.PRIMARY_EMAIL;
  const secondaryId = getArgValue("--secondary-id") || process.env.SECONDARY_ID;
  const secondaryEmail =
    getArgValue("--secondary-email") || process.env.SECONDARY_EMAIL;
  const dryRun = process.argv.includes("--dry-run");
  if (!primaryEmail) {
    throw new Error("Missing --primary-email (or PRIMARY_EMAIL env var).");
  }

  const url = getDatabaseUrl();
  if (!url) {
    throw new Error(
      "No DATABASE_URL/PRISMA_DATABASE_URL or prisma_url.txt found.",
    );
  }
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = url;
  }
  const prisma = new PrismaClient({ accelerateUrl: url });

  try {
    const primary = await loadPrimaryUser(prisma, primaryEmail);
    if (!primary) {
      throw new Error(`Primary user not found for email ${primaryEmail}`);
    }
    const secondary = await findSecondaryUser(
      prisma,
      primary,
      secondaryId,
      secondaryEmail,
    );
    if (!secondary) {
      throw new Error(
        "Secondary user not found. Provide --secondary-id or --secondary-email.",
      );
    }
    if (secondary && secondary.__candidates) {
      const candidates = secondary.__candidates;
      const ids = candidates.map((u) => `${u.id} (${u.email || "no email"})`);
      throw new Error(
        `Multiple secondary candidates found: ${ids.join(", ")}. Provide --secondary-id.`,
      );
    }
    if (secondary.id === primary.id) {
      throw new Error("Primary and secondary users are the same.");
    }

    console.log("Primary:", {
      id: primary.id,
      email: primary.email,
      name: `${primary.firstName || ""} ${primary.lastName || ""}`.trim(),
    });
    console.log("Secondary:", {
      id: secondary.id,
      email: secondary.email,
      name: `${secondary.firstName || ""} ${secondary.lastName || ""}`.trim(),
    });

    const summary = await mergeUsers(prisma, primary, secondary, dryRun);
    console.log("Merge summary:", summary);
    console.log(dryRun ? "Dry run complete." : "Merge complete.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
