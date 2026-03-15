/*
  Clear all attendance, then set attendance for all users for the last 25 training sessions.
  Usage: DATABASE_URL=... node scripts/set-last-25-sessions-attendance.js [--dry-run]
*/

require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

// Redis connection helper (same as migrate script)
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

function toYMD(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmdUtc(input) {
  const match = String(input || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}

function parseDdMmYyyy(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/^([0-3]?\d)[-\/](0?\d|1[0-2])[-\/]((?:19|20)\d{2})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (
    date.getUTCFullYear() !== yyyy ||
    date.getUTCMonth() !== mm - 1 ||
    date.getUTCDate() !== dd
  )
    return null;
  return date;
}

function addYears(date, years) {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

function defaultSeasonWindow() {
  const envStart = parseDdMmYyyy(process.env.SEASON_START);
  const envEnd = parseDdMmYyyy(process.env.SEASON_END);

  if (envStart && envEnd && envStart < envEnd) {
    return { from: toYMD(envStart), to: toYMD(envEnd) };
  }
  if (envStart && !envEnd) {
    const end = addYears(envStart, 1);
    return { from: toYMD(envStart), to: toYMD(end) };
  }
  if (!envStart && envEnd) {
    const start = addYears(envEnd, -1);
    return { from: toYMD(start), to: toYMD(envEnd) };
  }

  // Fallback: Season runs July 1st to July 1st next year
  const now = new Date();
  const year = now.getUTCFullYear();
  const isBeforeJuly = now.getUTCMonth() < 6;
  const seasonStart = isBeforeJuly
    ? new Date(Date.UTC(year - 1, 6, 1))
    : new Date(Date.UTC(year, 6, 1));
  const seasonEnd = isBeforeJuly
    ? new Date(Date.UTC(year, 6, 1))
    : new Date(Date.UTC(year + 1, 6, 1));
  return { from: toYMD(seasonStart), to: toYMD(seasonEnd) };
}

function generateTrainingDates(from, to) {
  const dates = [];
  const start = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
  );
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0); // Reset time to start of day for comparison

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const weekday = d.getUTCDay();
    if (weekday === 3 || weekday === 5) {
      const dateStr = toYMD(new Date(d));
      const dateObj = new Date(d);
      dateObj.setUTCHours(0, 0, 0, 0);
      // Only include dates in the past (before today)
      if (dateObj < today) {
        dates.push(dateStr);
      }
    }
  }
  return dates;
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
    console.log("=== Set Last 25 Training Sessions Attendance ===\n");
    if (dryRun) {
      console.log("🔍 DRY RUN MODE - No changes will be made\n");
    }

    // Get season window
    const window = defaultSeasonWindow();

    // Generate only PAST training dates
    const fromDate = parseYmdUtc(window.from);
    const toDate = parseYmdUtc(window.to);
    if (!fromDate || !toDate) {
      throw new Error("Invalid season window date format; expected YYYY-MM-DD");
    }
    const pastDates = generateTrainingDates(fromDate, toDate);
    const today = new Date().toISOString().split("T")[0];

    console.log(`Season: ${window.from} to ${window.to}`);
    console.log(`Today: ${today}`);
    console.log(`Past training sessions: ${pastDates.length}\n`);

    if (pastDates.length === 0) {
      console.log("⚠️  No past training sessions found!");
      return;
    }

    // Get the last 25 training sessions (most recent)
    const last25Sessions = pastDates.slice(-25).sort(); // Sort chronologically
    console.log(`Last 25 training sessions:`);
    console.log(`  From: ${last25Sessions[0]}`);
    console.log(`  To: ${last25Sessions[last25Sessions.length - 1]}\n`);

    // Get all users
    const users = await prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true },
    });
    console.log(`Found ${users.length} users\n`);

    if (users.length === 0) {
      console.log("No users found!");
      return;
    }

    if (!dryRun) {
      // Step 1: Clear ALL attendance records from database
      console.log("Clearing all attendance records from database...");
      const deleteResult = await prisma.attendance.deleteMany({});
      console.log(
        `✅ Deleted ${deleteResult.count} attendance records from database\n`,
      );

      // Step 1b: Clear ALL attendance records from Redis/KV
      console.log("Clearing all attendance records from Redis/KV...");
      const redis = await getRedis();
      if (redis) {
        try {
          const keys = await listAllAttendanceKeys(redis);
          if (keys.length > 0) {
            // Delete all attendance keys
            const redisKeys = keys.map((k) => `att:${k}`);
            await redis.del(...redisKeys);
            console.log(
              `✅ Deleted ${keys.length} attendance keys from Redis/KV\n`,
            );
          } else {
            console.log(`✅ No attendance keys found in Redis/KV\n`);
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.log(`⚠️  Could not clear Redis/KV: ${message}\n`);
        }
      } else {
        console.log(
          `⚠️  No Redis/KV connection available, skipping Redis cleanup\n`,
        );
      }

      // Step 2: Create attendance for all users for the last 25 sessions
      console.log(`Creating attendance for all users for last 25 sessions...`);
      const markedBy = users[0]?.id || "system";
      let totalCreated = 0;
      const userIds = users.map((u) => u.id);

      // Create attendance records in database
      for (const date of last25Sessions) {
        await prisma.attendance.createMany({
          data: userIds.map((userId) => ({
            date,
            userId,
            markedBy,
          })),
          skipDuplicates: true,
        });
      }

      // Also update Redis/KV for backward compatibility
      if (redis) {
        console.log(`Updating Redis/KV with new attendance data...`);
        for (const date of last25Sessions) {
          try {
            await redis.set(`att:${date}`, JSON.stringify(userIds));
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            console.log(`⚠️  Could not update Redis for ${date}: ${message}`);
          }
        }
        console.log(`✅ Updated Redis/KV for ${last25Sessions.length} dates\n`);
      }

      totalCreated = users.length * last25Sessions.length;
      console.log(`\n=== Complete ===`);
      console.log(`Created ${totalCreated} attendance records`);
      console.log(
        `(${users.length} users × ${last25Sessions.length} sessions)`,
      );
      console.log(`Updated database and Redis/KV`);
    } else {
      console.log(`[DRY RUN] Would:`);
      console.log(`  1. Delete all existing attendance records`);
      console.log(
        `  2. Create attendance for ${users.length} users × ${last25Sessions.length} sessions = ${users.length * last25Sessions.length} records`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Error:", message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
    const redis = await getRedis();
    if (redis && redis.quit) {
      await redis.quit();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
