/*
  Diagnose attendance data issues
  Usage: DATABASE_URL=... REDIS_URL=... node scripts/diagnose-attendance.js
*/

const { PrismaClient } = require("@prisma/client");

async function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const IORedis = require("ioredis");
  const redis = new IORedis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
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
    console.log("=== Attendance Data Diagnosis ===\n");

    // Get all attendance keys
    const keys = await listAllAttendanceKeys(redis);
    console.log(`Found ${keys.length} attendance keys in storage\n`);

    if (keys.length === 0) {
      console.log("❌ No attendance data found in storage!");
      console.log(
        "This suggests the data was never stored or has been deleted.",
      );
      return;
    }

    // Get all users from database
    const users = await prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const userIds = new Set(users.map((u) => u.id));
    console.log(`Found ${users.length} users in database\n`);

    // Analyze attendance data
    const allAttendanceUserIds = new Set();
    const orphanedUserIds = new Set();
    const dateUserMap = new Map();

    console.log("Scanning attendance data...");
    for (const dateKey of keys) {
      const attUserIds = await getAttendance(redis, dateKey);
      dateUserMap.set(dateKey, attUserIds);
      for (const userId of attUserIds) {
        allAttendanceUserIds.add(userId);
        if (!userIds.has(userId)) {
          orphanedUserIds.add(userId);
        }
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(
      `Total unique user IDs in attendance data: ${allAttendanceUserIds.size}`,
    );
    console.log(`Orphaned user IDs (not in database): ${orphanedUserIds.size}`);

    if (orphanedUserIds.size > 0) {
      console.log(`\n⚠️  Found ${orphanedUserIds.size} orphaned user IDs:`);
      const orphanedArray = Array.from(orphanedUserIds).slice(0, 10);
      for (const userId of orphanedArray) {
        // Find dates where this user appears
        const dates = [];
        for (const [date, uids] of dateUserMap.entries()) {
          if (uids.includes(userId)) {
            dates.push(date);
          }
        }
        console.log(`  - ${userId} (appears in ${dates.length} dates)`);
        if (dates.length > 0) {
          console.log(
            `    Dates: ${dates.slice(0, 5).join(", ")}${dates.length > 5 ? "..." : ""}`,
          );
        }
      }
      if (orphanedUserIds.size > 10) {
        console.log(`  ... and ${orphanedUserIds.size - 10} more`);
      }
    }

    // Check date distribution
    console.log(`\n=== Date Distribution ===`);
    const sortedKeys = keys.sort();
    if (sortedKeys.length > 0) {
      console.log(`First date: ${sortedKeys[0]}`);
      console.log(`Last date: ${sortedKeys[sortedKeys.length - 1]}`);
    }

    // Check for gaps
    const datesWithData = sortedKeys.filter((k) => {
      const uids = dateUserMap.get(k) || [];
      return uids.length > 0;
    });
    console.log(
      `\nDates with attendance data: ${datesWithData.length} / ${sortedKeys.length}`,
    );

    if (datesWithData.length < sortedKeys.length) {
      console.log(
        `⚠️  ${sortedKeys.length - datesWithData.length} dates have no attendance data`,
      );
    }

    // Sample some dates
    console.log(`\n=== Sample Data ===`);
    for (const dateKey of sortedKeys.slice(0, 5)) {
      const attUserIds = await getAttendance(redis, dateKey);
      const valid = attUserIds.filter((id) => userIds.has(id)).length;
      const orphaned = attUserIds.length - valid;
      console.log(
        `${dateKey}: ${attUserIds.length} users (${valid} valid, ${orphaned} orphaned)`,
      );
    }
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
