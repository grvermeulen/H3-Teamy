/*
  Delete placeholder users (users with empty firstName/lastName and no email).
  These are temporary users created for anonymous/cookie-based sessions.
  Usage: DATABASE_URL=... node scripts/cleanup-placeholder-users.js [--dry-run]
*/

require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

function isPlaceholderUser(user) {
  const hasName = !!(
    (user.firstName || "").trim() || (user.lastName || "").trim()
  );
  const hasEmail = !!(user.email || "").trim();
  return !hasName && !hasEmail;
}

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
    console.log("=== Cleanup Placeholder Users ===\n");
    if (dryRun) {
      console.log("🔍 DRY RUN MODE - No changes will be made\n");
    }

    // Get all users
    const users = await prisma.user.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    });

    console.log(`Found ${users.length} total users\n`);

    // Find placeholder users
    const placeholderUsers = users.filter((u) => isPlaceholderUser(u));

    if (placeholderUsers.length === 0) {
      console.log("✅ No placeholder users found!");
      return;
    }

    console.log(`Found ${placeholderUsers.length} placeholder users:\n`);

    // Check for related records
    for (const user of placeholderUsers.slice(0, 10)) {
      const rsvpCount = await prisma.rsvp.count({ where: { userId: user.id } });
      const attendanceCount = await prisma.attendance.count({
        where: { userId: user.id },
      });
      const identityCount = await prisma.identity.count({
        where: { userId: user.id },
      });

      console.log(
        `  ${user.id.slice(0, 8)}... - RSVPs: ${rsvpCount}, Attendance: ${attendanceCount}, Identities: ${identityCount}`,
      );
    }
    if (placeholderUsers.length > 10) {
      console.log(`  ... and ${placeholderUsers.length - 10} more`);
    }

    // Check if any have related records
    const usersWithRecords = [];
    for (const user of placeholderUsers) {
      const rsvpCount = await prisma.rsvp.count({ where: { userId: user.id } });
      const attendanceCount = await prisma.attendance.count({
        where: { userId: user.id },
      });
      if (rsvpCount > 0 || attendanceCount > 0) {
        usersWithRecords.push({ user, rsvpCount, attendanceCount });
      }
    }

    if (usersWithRecords.length > 0) {
      console.log(
        `\n⚠️  Warning: ${usersWithRecords.length} placeholder users have related records:`,
      );
      for (const { user, rsvpCount, attendanceCount } of usersWithRecords) {
        console.log(
          `  ${user.id.slice(0, 8)}... - RSVPs: ${rsvpCount}, Attendance: ${attendanceCount}`,
        );
      }
      console.log(
        "\nThese users will NOT be deleted. Please review them manually.",
      );
    }

    // Only delete users without any related records
    const usersToDelete = placeholderUsers.filter((user) => {
      return !usersWithRecords.some((wr) => wr.user.id === user.id);
    });

    if (usersToDelete.length === 0) {
      console.log("\n✅ No placeholder users can be safely deleted.");
      return;
    }

    console.log(
      `\n${usersToDelete.length} placeholder users can be safely deleted.`,
    );

    if (!dryRun) {
      console.log("\nDeleting placeholder users...");
      let deleted = 0;
      let errors = 0;

      for (const user of usersToDelete) {
        try {
          // Delete identities first (they have CASCADE, but let's be explicit)
          await prisma.identity.deleteMany({ where: { userId: user.id } });
          // Delete user (RSVPs have RESTRICT, but we checked they don't exist)
          await prisma.user.delete({ where: { id: user.id } });
          deleted++;
        } catch (error) {
          errors++;
          console.error(
            `  ❌ Failed to delete ${user.id.slice(0, 8)}...: ${error.message}`,
          );
        }
      }

      console.log(`\n=== Complete ===`);
      console.log(`Deleted: ${deleted} placeholder users`);
      if (errors > 0) {
        console.log(`Errors: ${errors}`);
      }
    } else {
      console.log(
        `\n[DRY RUN] Would delete ${usersToDelete.length} placeholder users`,
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
