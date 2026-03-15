/*
  Deletes attendance records for users that no longer exist in the database.
  Usage:
    DATABASE_URL=... node scripts/cleanup-orphaned-attendance.js [--dry-run]
*/

require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Ensure DATABASE_URL is set from DIRECT_DATABASE_URL if needed
  if (!process.env.DATABASE_URL && process.env.DIRECT_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
  }

  // Prefer Accelerate URL if available
  let prisma;
  const fs = require("fs");
  let accelerateUrl = null;
  try {
    accelerateUrl = fs.readFileSync("prisma_url.txt", "utf-8").trim();
  } catch (e) {
    // prisma_url.txt not found, continue
  }

  if (accelerateUrl && accelerateUrl.startsWith("prisma://")) {
    console.log("Using Prisma Accelerate connection...\n");
    prisma = new PrismaClient({ accelerateUrl });
  } else {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error("❌ DATABASE_URL must be set in .env file or environment");
      process.exit(1);
    }
    console.log("Using direct PostgreSQL connection...\n");
    const pool = new Pool({ connectionString: dbUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }

  try {
    console.log("=== Cleanup Orphaned Attendance Records ===\n");
    if (dryRun) {
      console.log("🔍 DRY RUN MODE - No changes will be made\n");
    }

    // Get all valid user IDs
    const users = await prisma.user.findMany({
      select: { id: true },
    });
    const validUserIds = new Set(users.map((u) => u.id));
    console.log(`Found ${users.length} valid users in database\n`);

    // Find all attendance records
    const allAttendance = await prisma.attendance.findMany({
      select: { id: true, userId: true, date: true },
    });
    console.log(`Found ${allAttendance.length} total attendance records\n`);

    // Find orphaned attendance records (where userId doesn't exist)
    const orphanedAttendance = allAttendance.filter(
      (att) => !validUserIds.has(att.userId),
    );

    if (orphanedAttendance.length === 0) {
      console.log("✅ No orphaned attendance records found!");
      return;
    }

    // Group by userId to show summary
    const orphanedByUser = new Map();
    for (const att of orphanedAttendance) {
      const count = orphanedByUser.get(att.userId) || 0;
      orphanedByUser.set(att.userId, count + 1);
    }

    console.log(
      `Found ${orphanedAttendance.length} orphaned attendance records`,
    );
    console.log(`Affecting ${orphanedByUser.size} deleted user IDs:\n`);

    // Show first 10 orphaned user IDs
    const orphanedUserIds = Array.from(orphanedByUser.entries());
    orphanedUserIds.slice(0, 10).forEach(([userId, count]) => {
      console.log(`  - ${userId.slice(0, 8)}...: ${count} attendance records`);
    });
    if (orphanedUserIds.length > 10) {
      console.log(
        `  ... and ${orphanedUserIds.length - 10} more deleted users`,
      );
    }

    if (!dryRun) {
      console.log("\nDeleting orphaned attendance records...");
      const result = await prisma.attendance.deleteMany({
        where: {
          userId: { notIn: Array.from(validUserIds) },
        },
      });
      console.log(`✅ Deleted ${result.count} orphaned attendance records`);
    } else {
      console.log(
        `\n[DRY RUN] Would delete ${orphanedAttendance.length} orphaned attendance records`,
      );
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
