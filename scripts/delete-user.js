/*
  Delete a specific user by ID
  Usage: DATABASE_URL=... node scripts/delete-user.js <userId>
*/

// Load environment variables from .env if available
require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

async function main() {
  const userId = process.argv[2];

  if (!userId) {
    console.error("❌ Usage: node scripts/delete-user.js <userId>");
    process.exit(1);
  }

  // Ensure DATABASE_URL is set from DIRECT_DATABASE_URL if needed
  if (!process.env.DATABASE_URL && process.env.DIRECT_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ DATABASE_URL must be set in .env file or environment");
    process.exit(1);
  }

  console.log("Using direct PostgreSQL connection...\n");
  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log(`=== Deleting User: ${userId} ===\n`);

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    });

    if (!user) {
      console.log(`❌ User not found: ${userId}`);
      return;
    }

    console.log(
      `Found user: ${user.firstName} ${user.lastName} (${user.email || "no email"})\n`,
    );

    // Check related records
    const rsvpCount = await prisma.rsvp.count({
      where: { userId },
    });

    const attendanceCount = await prisma.attendance.count({
      where: { userId },
    });

    const identityCount = await prisma.identity.count({
      where: { userId },
    });

    console.log("Related records:");
    console.log(`  - RSVPs: ${rsvpCount}`);
    console.log(`  - Attendance: ${attendanceCount}`);
    console.log(`  - Identities: ${identityCount}\n`);

    if (rsvpCount > 0) {
      console.log(
        "⚠️  User has RSVPs. These need to be deleted first due to RESTRICT constraint.",
      );
      console.log("Deleting RSVPs...\n");

      // Delete RSVPs first (they have RESTRICT constraint)
      const rsvpResult = await prisma.rsvp.deleteMany({
        where: { userId },
      });
      console.log(`✅ Deleted ${rsvpResult.count} RSVP records`);
    }

    // Delete user (Attendance and Identity will be deleted automatically due to CASCADE)
    console.log("\nDeleting user...");
    await prisma.user.delete({
      where: { id: userId },
    });

    console.log(`\n✅ Successfully deleted user: ${userId}`);
    console.log(
      `   (Also deleted ${attendanceCount} attendance records and ${identityCount} identity records due to CASCADE)`,
    );
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.code === "P2003") {
      console.error(
        "\nThis error usually means there are foreign key constraints preventing deletion.",
      );
      console.error("Make sure all RSVPs are deleted first.");
    }
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
