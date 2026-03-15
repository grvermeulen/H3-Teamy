/*
  Set everyone to 30% attendance for the current season
  Usage: DATABASE_URL=... node scripts/set-attendance-30-percent.js [--dry-run]
*/

// Load environment variables from .env if available
require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

function toYMD(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function parseYmdUtc(input) {
  const m = String(input)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const parsed = new Date(Date.UTC(y, mo - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== mo - 1 ||
    parsed.getUTCDate() !== d
  ) {
    return null;
  }
  return parsed;
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

  // Prefer Accelerate URL if available (same as Prisma Studio uses)
  let prisma;
  const fs = require("fs");
  let accelerateUrl = null;
  try {
    accelerateUrl = fs.readFileSync("prisma_url.txt", "utf-8").trim();
  } catch (e) {
    // prisma_url.txt not found, continue
  }

  if (accelerateUrl && accelerateUrl.startsWith("prisma://")) {
    // Use Accelerate URL (same as Prisma Studio)
    console.log("Using Prisma Accelerate connection...\n");
    prisma = new PrismaClient({ accelerateUrl });
  } else {
    // Fall back to direct connection
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error("ÔØî DATABASE_URL must be set in .env file or environment");
      process.exit(1);
    }
    console.log("Using direct PostgreSQL connection...\n");
    const pool = new Pool({ connectionString: dbUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }

  try {
    console.log("=== Set Everyone to 30% Attendance ===\n");
    if (dryRun) {
      console.log("­ƒöì DRY RUN MODE - No changes will be made\n");
    }

    // Get season window
    const window = defaultSeasonWindow();

    // Generate ALL training dates for the season (past and future)
    const allSeasonDates = [];
    const start = parseYmdUtc(window.from);
    const end = parseYmdUtc(window.to);
    if (!start || !end) {
      throw new Error("Kon seizoensdatums niet parsen.");
    }
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const weekday = d.getUTCDay();
      if (weekday === 3 || weekday === 5) {
        allSeasonDates.push(toYMD(new Date(d)));
      }
    }

    // Generate only PAST training dates (for assignment)
    const pastDates = generateTrainingDates(start, end);
    const today = toYMD(new Date());

    console.log(`Season: ${window.from} to ${window.to}`);
    console.log(`Today: ${today}`);
    console.log(`Total season sessions: ${allSeasonDates.length}`);
    console.log(`Past training sessions: ${pastDates.length}\n`);

    // Calculate 30% of TOTAL season sessions (use calculated total, not hardcoded)
    const totalSeasonSessions = allSeasonDates.length;
    const targetCount = Math.round(totalSeasonSessions * 0.3); // 30% of total
    console.log(
      `Target attendance: ${targetCount} out of ${totalSeasonSessions} total season sessions (30%)\n`,
    );
    console.log(
      `Note: Using only past sessions (${pastDates.length} available) to assign these ${targetCount} sessions.\n`,
    );

    if (pastDates.length === 0) {
      console.log(
        "ÔÜá´©Å  No past training sessions found in the season window!",
      );
      return;
    }

    if (pastDates.length < targetCount) {
      console.log(
        `ÔÜá´©Å  Warning: Only ${pastDates.length} past sessions available, but need ${targetCount} for 30% of season total.`,
      );
      console.log(`   Will assign all ${pastDates.length} past sessions.\n`);
    }

    // Get all users
    const users = await prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true },
    });
    console.log(`Found ${users.length} users\n`);

    if (users.length === 0) {
      console.log("No users found!");
      return;
    }

    // For each user, randomly select 30% of dates
    let totalCreated = 0;
    const markedBy = users[0]?.id || "system";

    for (const user of users) {
      // Shuffle past dates and take up to targetCount (30% of total season)
      const shuffled = [...pastDates].sort(() => Math.random() - 0.5);
      const selectedDates = shuffled.slice(
        0,
        Math.min(targetCount, pastDates.length),
      );

      if (!dryRun) {
        // Delete existing attendance for this user in season (all dates, not just past)
        await prisma.attendance.deleteMany({
          where: {
            userId: user.id,
            date: { in: allSeasonDates },
          },
        });

        // Create new attendance records
        if (selectedDates.length > 0) {
          await prisma.attendance.createMany({
            data: selectedDates.map((date) => ({
              date,
              userId: user.id,
              markedBy,
            })),
            skipDuplicates: true,
          });
        }
        totalCreated += selectedDates.length;
      }

      const name =
        `${user.firstName} ${user.lastName}`.trim() || user.id.slice(0, 6);
      console.log(
        `${dryRun ? "[DRY RUN] " : ""}${name}: ${selectedDates.length} dates`,
      );
    }

    console.log(`\n=== Complete ===`);
    if (!dryRun) {
      console.log(`Created ${totalCreated} attendance records`);
    } else {
      console.log(
        `Would create ${users.length * targetCount} attendance records`,
      );
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
