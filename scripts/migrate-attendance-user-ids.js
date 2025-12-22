/*
  Migrate attendance data user IDs from deleted users to their merged identities
  This script finds orphaned user IDs in attendance data and maps them to current users via Identity table
  
  Usage: DATABASE_URL=... REDIS_URL=... node scripts/migrate-attendance-user-ids.js [--dry-run]
*/

const { PrismaClient } = require("@prisma/client");

async function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.error("❌ REDIS_URL not set");
    return null;
  }
  const IORedis = require("ioredis");
  const redis = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  try {
    await redis.connect();
  } catch (e) {
    console.error("Failed to connect to Redis:", e.message);
    return null;
  }
  return redis;
}

async function listAllAttendanceKeys(redis) {
  if (redis) {
    const keys = await redis.keys("att:*");
    return keys.map((k) => k.replace("att:", "")).sort();
  }
  return [];
}

async function getAttendance(redis, dateYmd) {
  const key = `att:${dateYmd}`;
  if (redis) {
    const raw = await redis.get(key);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

async function setAttendance(redis, dateYmd, userIds) {
  const key = `att:${dateYmd}`;
  if (redis) {
    await redis.set(key, JSON.stringify(userIds));
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();
  const redis = await getRedis();

  if (!redis) {
    console.error("Cannot proceed without Redis connection");
    process.exit(1);
  }

  try {
    console.log("=== Attendance User ID Migration ===\n");
    if (dryRun) {
      console.log("🔍 DRY RUN MODE - No changes will be made\n");
    }

    // Get all users from database
    const users = await prisma.user.findMany({
      select: { id: true },
    });
    const validUserIds = new Set(users.map((u) => u.id));
    console.log(`Found ${users.length} users in database`);

    // Get all identities to build mapping
    const identities = await prisma.identity.findMany({
      select: { userId: true, provider: true, providerUserId: true },
    });

    // Build mapping: oldUserId -> newUserId
    // If a user was deleted, try to find their identity and map to current user
    const userIdMapping = new Map();
    
    // Get all attendance keys
    const keys = await listAllAttendanceKeys(redis);
    console.log(`Found ${keys.length} attendance keys\n`);

    if (keys.length === 0) {
      console.log("❌ No attendance data found!");
      return;
    }

    // Find all orphaned user IDs
    const orphanedUserIds = new Set();
    for (const dateKey of keys) {
      const userIds = await getAttendance(redis, dateKey);
      for (const userId of userIds) {
        if (!validUserIds.has(userId)) {
          orphanedUserIds.add(userId);
        }
      }
    }

    console.log(`Found ${orphanedUserIds.size} orphaned user IDs\n`);

    if (orphanedUserIds.size === 0) {
      console.log("✅ No orphaned user IDs found - nothing to migrate!");
      return;
    }

    // Try to map orphaned IDs to current users via identities
    // This is tricky - we need to find if the deleted user's identity was merged
    // For now, we'll create a manual mapping approach
    console.log("Orphaned user IDs that need mapping:");
    for (const orphanedId of Array.from(orphanedUserIds).slice(0, 20)) {
      // Check if there are any identities that might have been linked to this user
      // This is a heuristic - we can't perfectly map without more context
      console.log(`  - ${orphanedId}`);
    }
    if (orphanedUserIds.size > 20) {
      console.log(`  ... and ${orphanedUserIds.size - 20} more`);
    }

    console.log("\n⚠️  Automatic mapping is not possible without additional context.");
    console.log("You may need to manually map these user IDs or restore the deleted users.");
    console.log("\nAlternative: If you have backups, you could restore the deleted users temporarily,");
    console.log("then use the identity/adopt endpoint to properly merge them.");

    // For now, we'll just report what needs to be done
    // In a real scenario, you might want to:
    // 1. Check if there are backups of deleted users
    // 2. Use email/cookie matching to find the correct current user
    // 3. Manually create a mapping file

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
    if (redis) await redis.quit();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

