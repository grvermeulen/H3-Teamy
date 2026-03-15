/*
  Merge duplicate users with the same first and last name (case-insensitive)
  Usage: DATABASE_URL=... node scripts/merge-duplicate-users.js [--dry-run] [--confirm]
*/

// Load environment variables from .env if available
require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

function normalizeName(name) {
  const normalized = (name || "").trim().toLowerCase();
  return normalized || null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const confirm = process.argv.includes("--confirm");

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
    console.log("=== Merge Duplicate Users ===\n");

    if (dryRun) {
      console.log("🔍 DRY RUN MODE - No changes will be made\n");
    }

    // Get all users
    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    console.log(`Found ${allUsers.length} total users\n`);

    // Group users by normalized name
    const nameGroups = new Map();
    for (const user of allUsers) {
      const normalizedFirstName = normalizeName(user.firstName);
      const normalizedLastName = normalizeName(user.lastName);
      if (!normalizedFirstName || !normalizedLastName) {
        continue;
      }
      const nameKey = `${normalizedFirstName}|${normalizedLastName}`;

      if (!nameGroups.has(nameKey)) {
        nameGroups.set(nameKey, []);
      }
      nameGroups.get(nameKey).push(user);
    }

    // Find groups with duplicates (more than 1 user)
    const duplicates = [];
    for (const [nameKey, users] of nameGroups.entries()) {
      if (users.length > 1) {
        duplicates.push({ nameKey, users });
      }
    }

    console.log(`Found ${duplicates.length} groups with duplicate names\n`);

    if (duplicates.length === 0) {
      console.log("✅ No duplicate users found!");
      return;
    }

    // Show duplicates
    console.log("Duplicate groups:");
    for (const { nameKey, users } of duplicates) {
      const [firstName, lastName] = nameKey.split("|");
      console.log(`\n  "${firstName} ${lastName}" (${users.length} users):`);
      for (const user of users) {
        const email = user.email || "no email";
        const created = new Date(user.createdAt).toISOString().split("T")[0];
        console.log(
          `    - ${user.id.slice(0, 8)}... (${user.firstName} ${user.lastName}, ${email}, created: ${created})`,
        );
      }
    }

    if (dryRun) {
      console.log("\n🔍 DRY RUN: Would merge these duplicates");
      return;
    }

    if (!confirm) {
      console.log(
        "\n⚠️  This will merge duplicate users and delete the duplicates!",
      );
      console.log("Add --confirm flag to proceed with merging");
      return;
    }

    console.log("\n🔄 Merging duplicates...\n");

    let merged = 0;
    let totalMerged = 0;

    for (const { nameKey, users } of duplicates) {
      // Sort by creation date - keep the oldest one as primary
      const sorted = [...users].sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      );
      const primary = sorted[0];
      const duplicatesToMerge = sorted.slice(1);

      console.log(`Merging "${primary.firstName} ${primary.lastName}":`);
      console.log(
        `  Primary: ${primary.id.slice(0, 8)}... (created: ${new Date(primary.createdAt).toISOString().split("T")[0]})`,
      );

      for (const duplicate of duplicatesToMerge) {
        console.log(`  Merging: ${duplicate.id.slice(0, 8)}...`);

        // Count related records
        const rsvpCount = await prisma.rsvp.count({
          where: { userId: duplicate.id },
        });
        const attendanceCount = await prisma.attendance.count({
          where: { userId: duplicate.id },
        });
        const identityCount = await prisma.identity.count({
          where: { userId: duplicate.id },
        });

        // Update RSVPs to point to primary user
        if (rsvpCount > 0) {
          // Get all duplicate RSVPs
          const duplicateRsvps = await prisma.rsvp.findMany({
            where: { userId: duplicate.id },
            select: { eventId: true },
          });

          let moved = 0;
          let skipped = 0;

          for (const rsvp of duplicateRsvps) {
            // Check if primary already has RSVP for this event
            const existing = await prisma.rsvp.findUnique({
              where: {
                userId_eventId: {
                  userId: primary.id,
                  eventId: rsvp.eventId,
                },
              },
            });

            if (!existing) {
              // Move RSVP to primary
              await prisma.rsvp.updateMany({
                where: {
                  userId: duplicate.id,
                  eventId: rsvp.eventId,
                },
                data: { userId: primary.id },
              });
              moved++;
            } else {
              // Delete duplicate RSVP (primary already has one)
              await prisma.rsvp.deleteMany({
                where: {
                  userId: duplicate.id,
                  eventId: rsvp.eventId,
                },
              });
              skipped++;
            }
          }
          console.log(
            `    - Moved ${moved} RSVPs, skipped ${skipped} duplicates`,
          );
        }

        // Update Attendance to point to primary user
        if (attendanceCount > 0) {
          // Need to handle unique constraint on (date, userId)
          // Delete duplicates and keep the primary's attendance for each date
          const duplicateAttendance = await prisma.attendance.findMany({
            where: { userId: duplicate.id },
            select: { date: true },
          });

          for (const att of duplicateAttendance) {
            // Check if primary already has attendance for this date
            const existing = await prisma.attendance.findUnique({
              where: {
                date_userId: {
                  date: att.date,
                  userId: primary.id,
                },
              },
            });

            if (!existing) {
              // Move attendance to primary
              await prisma.attendance.updateMany({
                where: {
                  date: att.date,
                  userId: duplicate.id,
                },
                data: { userId: primary.id },
              });
            } else {
              // Delete duplicate attendance (primary already has it)
              await prisma.attendance.deleteMany({
                where: {
                  date: att.date,
                  userId: duplicate.id,
                },
              });
            }
          }
          console.log(
            `    - Moved/merged ${attendanceCount} attendance records`,
          );
        }

        // Update Identities to point to primary user
        if (identityCount > 0) {
          // Need to handle unique constraint on (provider, providerUserId)
          const duplicateIdentities = await prisma.identity.findMany({
            where: { userId: duplicate.id },
            select: { provider: true, providerUserId: true },
          });

          for (const identity of duplicateIdentities) {
            // Check if primary already has this identity
            const existing = await prisma.identity.findFirst({
              where: {
                provider: identity.provider,
                providerUserId: identity.providerUserId,
                userId: primary.id,
              },
            });

            if (!existing) {
              // Move identity to primary
              await prisma.identity.updateMany({
                where: {
                  provider: identity.provider,
                  providerUserId: identity.providerUserId,
                  userId: duplicate.id,
                },
                data: { userId: primary.id },
              });
            } else {
              // Delete duplicate identity (primary already has it)
              await prisma.identity.deleteMany({
                where: {
                  provider: identity.provider,
                  providerUserId: identity.providerUserId,
                  userId: duplicate.id,
                },
              });
            }
          }
          console.log(`    - Moved/merged ${identityCount} identity records`);
        }

        // Update primary user's email if duplicate has one and primary doesn't
        if (!primary.email && duplicate.email) {
          await prisma.user.update({
            where: { id: primary.id },
            data: { email: duplicate.email },
          });
          console.log(`    - Copied email: ${duplicate.email}`);
        }

        // Delete the duplicate user (RSVPs already moved, so this should work)
        await prisma.user.delete({
          where: { id: duplicate.id },
        });

        console.log(`    ✅ Merged and deleted duplicate`);
        totalMerged++;
      }

      merged++;
      console.log(`  ✅ Completed merging group\n`);
    }

    console.log(`\n=== Merge Complete ===`);
    console.log(`Merged ${merged} groups`);
    console.log(`Deleted ${totalMerged} duplicate users`);
  } catch (error) {
    console.error("❌ Error:", error.message);
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
