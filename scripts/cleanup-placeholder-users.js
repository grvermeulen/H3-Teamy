const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

function loadDatabaseUrl() {
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

async function main() {
  const url = loadDatabaseUrl();
  if (!url) {
    throw new Error(
      "No DATABASE_URL/PRISMA_DATABASE_URL or prisma_url.txt found.",
    );
  }
  const prisma = url.startsWith("prisma://")
    ? new PrismaClient({ accelerateUrl: url })
    : new PrismaClient({ datasources: { db: { url } } });

  try {
    const placeholders = await prisma.user.findMany({
      where: {
        AND: [
          { firstName: "" },
          { lastName: "" },
          { OR: [{ email: null }, { email: "" }] },
        ],
      },
      select: { id: true },
    });

    if (!placeholders.length) {
      console.log("No placeholder users found.");
      return;
    }

    const ids = placeholders.map((u) => u.id);
    console.log(`Found ${ids.length} placeholder users. Deleting...`);

    await prisma.rsvp.deleteMany({ where: { userId: { in: ids } } });
    await prisma.attendance.deleteMany({ where: { userId: { in: ids } } });
    await prisma.identity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.linkCode.deleteMany({ where: { userId: { in: ids } } });

    // Best-effort cleanup for report/vote tables if present.
    await prisma
      .$executeRawUnsafe(
        'DELETE FROM "MatchReport" WHERE "authorId" = ANY($1)',
        ids,
      )
      .catch(() => {});
    await prisma
      .$executeRawUnsafe(
        'DELETE FROM "MvpVote" WHERE "voterId" = ANY($1) OR "candidateId" = ANY($1)',
        ids,
      )
      .catch(() => {});

    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`Deleted ${ids.length} placeholder users.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
