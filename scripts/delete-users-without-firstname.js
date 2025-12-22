/*
  Delete all users without a first name
  Usage: DATABASE_URL=... node scripts/delete-users-without-firstname.js [--dry-run] [--confirm]
*/

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const fs = require("fs");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const confirm = process.argv.includes("--confirm");
  
  // Prefer Accelerate URL if available (same as Prisma Studio uses)
  let prisma;
  let pool = null; // Track pool for cleanup if we create it
  let accelerateUrl = null;
  try {
    accelerateUrl = fs.readFileSync("prisma_url.txt", "utf-8").trim();
  } catch (e) {
    // prisma_url.txt not found, continue
  }

  if (accelerateUrl && accelerateUrl.startsWith('prisma://')) {
    // Use Accelerate URL (same as Prisma Studio)
    console.log("Using Prisma Accelerate connection...\n");
    prisma = new PrismaClient({ accelerateUrl });
  } else {
    // Fall back to direct connection
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error("❌ DATABASE_URL must be set in .env file or environment");
      process.exit(1);
    }
    console.log("Using direct PostgreSQL connection...\n");
    pool = new Pool({ connectionString: dbUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }

  try {
    console.log("=== Delete Users Without First Name ===\n");
    
    if (dryRun) {
      console.log("🔍 DRY RUN MODE - No changes will be made\n");
    }

    // Find users without first name (empty string)
    // Note: firstName is required in schema, so we only check for empty strings
    const usersToDelete = await prisma.user.findMany({
      where: {
        firstName: "",
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    });

    console.log(`Found ${usersToDelete.length} users without first name\n`);

    if (usersToDelete.length === 0) {
      console.log("No users to delete!");
      return;
    }

    // Show first 10 users that will be deleted
    console.log("Users to be deleted (showing first 10):");
    usersToDelete.slice(0, 10).forEach((user, i) => {
      const name = `${user.firstName || '(null)'} ${user.lastName || ''}`.trim() || user.id.slice(0, 8);
      console.log(`  ${i + 1}. ${name} (${user.email || 'no email'}) - ID: ${user.id}`);
    });
    if (usersToDelete.length > 10) {
      console.log(`  ... and ${usersToDelete.length - 10} more`);
    }

    // Check for related records
    console.log("\nChecking for related records...");
    const userIds = usersToDelete.map(u => u.id);
    
    const attendanceCount = await prisma.attendance.count({
      where: { userId: { in: userIds } },
    });
    
    const rsvpCount = await prisma.rsvp.count({
      where: { userId: { in: userIds } },
    });
    
    const identityCount = await prisma.identity.count({
      where: { userId: { in: userIds } },
    });

    console.log(`  - Attendance records: ${attendanceCount}`);
    console.log(`  - RSVP records: ${rsvpCount}`);
    console.log(`  - Identity records: ${identityCount}`);

    if (attendanceCount > 0 || rsvpCount > 0 || identityCount > 0) {
      console.log("\n⚠️  Warning: These users have related records that will be deleted due to CASCADE constraints:");
      if (attendanceCount > 0) console.log(`   - ${attendanceCount} attendance records`);
      if (rsvpCount > 0) console.log(`   - ${rsvpCount} RSVP records`);
      if (identityCount > 0) console.log(`   - ${identityCount} identity records`);
    }

    if (dryRun) {
      console.log("\n🔍 DRY RUN: Would delete these users and their related records");
      console.log(`Total records that would be deleted: ${usersToDelete.length + attendanceCount + rsvpCount + identityCount}`);
      return;
    }

    if (!confirm) {
      console.log("\n⚠️  This will permanently delete these users and their related records!");
      console.log("Add --confirm flag to proceed with deletion");
      return;
    }

    console.log("\n🗑️  Deleting users...");
    
    // Delete users (related records will be deleted due to CASCADE)
    const result = await prisma.user.deleteMany({
      where: {
        firstName: "",
      },
    });

    console.log(`\n✅ Deleted ${result.count} users`);
    console.log(`   (Also deleted ${attendanceCount} attendance records, ${rsvpCount} RSVP records, ${identityCount} identity records due to CASCADE)`);

  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error);
  } finally {
    // Properly disconnect Prisma (handles all cleanup)
    await prisma.$disconnect();
    // If we created a pool separately, close it using the public API
    if (pool) {
      await pool.end();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

