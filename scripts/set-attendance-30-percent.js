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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
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
  const date = new Date(yyyy, mm - 1, dd);
  if (date.getFullYear() !== yyyy || date.getMonth() !== mm - 1 || date.getDate() !== dd) return null;
  return date;
}

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
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
  const year = now.getFullYear();
  const isBeforeJuly = now.getMonth() < 6;
  const seasonStart = isBeforeJuly ? new Date(year - 1, 6, 1) : new Date(year, 6, 1);
  const seasonEnd = isBeforeJuly ? new Date(year, 6, 1) : new Date(year + 1, 6, 1);
  return { from: toYMD(seasonStart), to: toYMD(seasonEnd) };
}

function generateTrainingDates(from, to) {
  const dates = [];
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const weekday = d.getDay();
    if (weekday === 3 || weekday === 5) {
      dates.push(toYMD(new Date(d)));
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
    const pool = new Pool({ connectionString: dbUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }

  try {
    console.log("=== Set Everyone to 30% Attendance ===\n");
    if (dryRun) {
      console.log("🔍 DRY RUN MODE - No changes will be made\n");
    }

    // Get season window
    const window = defaultSeasonWindow();
    const dates = generateTrainingDates(new Date(window.from), new Date(window.to));
    console.log(`Season: ${window.from} to ${window.to}`);
    console.log(`Training dates: ${dates.length}\n`);

    // Calculate 30% of dates
    const targetCount = Math.round(dates.length * 0.3);
    console.log(`Target attendance: ${targetCount} out of ${dates.length} (30%)\n`);

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
      // Shuffle dates and take first 30%
      const shuffled = [...dates].sort(() => Math.random() - 0.5);
      const selectedDates = shuffled.slice(0, targetCount);

      if (!dryRun) {
        // Delete existing attendance for this user in season
        await prisma.attendance.deleteMany({
          where: {
            userId: user.id,
            date: { in: dates },
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

      const name = `${user.firstName} ${user.lastName}`.trim() || user.id.slice(0, 6);
      console.log(`${dryRun ? "[DRY RUN] " : ""}${name}: ${selectedDates.length} dates`);
    }

    console.log(`\n=== Complete ===`);
    if (!dryRun) {
      console.log(`Created ${totalCreated} attendance records`);
    } else {
      console.log(`Would create ${users.length * targetCount} attendance records`);
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

