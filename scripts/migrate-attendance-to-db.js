/*
  Migrate attendance data from Redis/KV to database
  Usage: DATABASE_URL=... REDIS_URL=... node scripts/migrate-attendance-to-db.js
*/

const { PrismaClient } = require("@prisma/client");

async function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const IORedis = require("ioredis");
  const redis = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  try {
    await redis.connect();
  } catch {}
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

async function main() {
  const prisma = new PrismaClient();
  const redis = await getRedis();

  try {
    console.log("=== Migrating Attendance Data to Database ===\n");

    if (!redis) {
      console.log("⚠️  No Redis connection found. Only migrating existing database records.");
    }

    // Get all attendance keys from Redis
    const keys = await listAllAttendanceKeys(redis);
    console.log(`Found ${keys.length} attendance keys in Redis\n`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const dateKey of keys) {
      const userIds = await getAttendance(redis, dateKey);
      if (userIds.length === 0) {
        skipped++;
        continue;
      }

      try {
        // Check if data already exists in database
        const existing = await prisma.attendance.findMany({
          where: { date: dateKey },
          select: { userId: true },
        });
        const existingUserIds = new Set(existing.map((e) => e.userId));

        // Only migrate if not already in database
        const toMigrate = userIds.filter((id) => !existingUserIds.has(id));
        if (toMigrate.length === 0) {
          skipped++;
          continue;
        }

        // Ensure users exist
        for (const userId of toMigrate) {
          await prisma.user.upsert({
            where: { id: userId },
            create: { id: userId, firstName: "", lastName: "" },
            update: {},
          }).catch(() => {});
        }

        // Insert attendance records (use first user as markedBy if available, otherwise use first userId)
        const markedBy = toMigrate[0] || "system";
        await prisma.attendance.createMany({
          data: toMigrate.map((userId) => ({
            date: dateKey,
            userId,
            markedBy,
          })),
          skipDuplicates: true,
        });

        migrated += toMigrate.length;
        console.log(`✓ ${dateKey}: Migrated ${toMigrate.length} records`);
      } catch (error) {
        errors++;
        console.error(`✗ ${dateKey}: Error - ${error.message}`);
      }
    }

    console.log(`\n=== Migration Complete ===`);
    console.log(`Migrated: ${migrated} records`);
    console.log(`Skipped: ${skipped} dates (already in DB or empty)`);
    console.log(`Errors: ${errors}`);
  } catch (error) {
    console.error("Fatal error:", error);
  } finally {
    await prisma.$disconnect();
    if (redis) await redis.quit();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

