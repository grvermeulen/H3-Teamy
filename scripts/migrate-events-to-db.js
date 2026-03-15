/*
  Migrate events, match reports, and MVP votes from KV/Redis to database.
  This script reads all data from KV and creates corresponding database records.
  Usage: DATABASE_URL=... node scripts/migrate-events-to-db.js [--dry-run]
*/

require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

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

  // Get Redis connection to read KV data
  let redis = null;
  if (process.env.REDIS_URL) {
    const IORedis = require("ioredis");
    redis = new IORedis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    try {
      await redis.connect();
      console.log("Connected to Redis...\n");
    } catch (e) {
      console.log("⚠️  Could not connect to Redis, skipping KV migration\n");
      redis = null;
    }
  }

  try {
    console.log("=== Migrate Events to Database ===\n");
    if (dryRun) {
      console.log("🔍 DRY RUN MODE - No changes will be made\n");
    }

    if (!redis) {
      console.log("⚠️  No Redis connection available. Cannot migrate KV data.");
      console.log("   Existing database records will be preserved.\n");
      return;
    }

    // 1. Scan RSVPs to discover existing event IDs (informational)
    console.log("1. Scanning event IDs from RSVPs...");
    const rsvps = await prisma.rsvp.findMany({
      select: { eventId: true },
      distinct: ["eventId"],
    });
    const eventIds = new Set(rsvps.map((r) => r.eventId));
    console.log(`   Found ${eventIds.size} unique event IDs from RSVPs\n`);

    // 2. Migrate match reports from KV
    console.log("2. Migrating match reports from KV...");
    const reportKeys = await redis.keys("report:*");
    console.log(`   Found ${reportKeys.length} report keys in KV`);

    const hasMatchReportModel = Boolean(prisma.matchReport);
    let reportsMigrated = 0;
    if (!hasMatchReportModel) {
      console.log(
        "   ⚠️  Skipping report migration: MatchReport model not available in Prisma schema.\n",
      );
    }
    for (const key of reportKeys) {
      const eventId = key.replace("report:", "");
      const raw = await redis.get(key);
      if (!raw) continue;

      try {
        const report = JSON.parse(raw);
        if (!report.content) continue;

        if (!dryRun && hasMatchReportModel) {
          await prisma.matchReport.upsert({
            where: { eventId },
            create: {
              eventId,
              content: report.content,
              authorId: report.authorId || null,
              mvpResult: report.mvpResult ? report.mvpResult : null,
            },
            update: {
              content: report.content,
              authorId: report.authorId || null,
              mvpResult: report.mvpResult ? report.mvpResult : null,
            },
          });
          reportsMigrated++;
        } else if (dryRun && hasMatchReportModel) {
          reportsMigrated++;
        }
      } catch (error) {
        console.log(
          `   ⚠️  Failed to migrate report for ${eventId}: ${error.message}`,
        );
      }
    }

    if (!dryRun) {
      console.log(`   ✅ Migrated ${reportsMigrated} match reports\n`);
    } else {
      console.log(
        `   [DRY RUN] Would migrate ${reportsMigrated} match reports\n`,
      );
    }

    // 3. Migrate MVP votes from KV
    console.log("3. Migrating MVP votes from KV...");
    const mvpKeys = await redis.keys("mvp:*");
    console.log(`   Found ${mvpKeys.length} MVP state keys in KV`);

    const hasMvpVoteModel = Boolean(prisma.mvpVote);
    let votesMigrated = 0;
    let eventsWithVotes = 0;
    if (!hasMvpVoteModel) {
      console.log(
        "   ⚠️  Skipping MVP vote migration: MvpVote model not available in Prisma schema.\n",
      );
    }
    for (const key of mvpKeys) {
      const eventId = key.replace("mvp:", "");
      const raw = await redis.get(key);
      if (!raw) continue;

      try {
        const state = JSON.parse(raw);
        if (!state.votes || !Array.isArray(state.votes)) continue;

        if (!dryRun && hasMvpVoteModel) {
          // Delete existing votes for this event
          await prisma.mvpVote.deleteMany({ where: { eventId } });

          // Insert votes
          if (state.votes.length > 0) {
            await prisma.mvpVote.createMany({
              data: state.votes.map((vote) => ({
                eventId,
                voterId: vote.voterId,
                candidateId: vote.candidateId,
                candidateName: vote.candidateName,
              })),
            });
            votesMigrated += state.votes.length;
            eventsWithVotes++;
          }
        } else if (dryRun && hasMvpVoteModel) {
          votesMigrated += state.votes.length;
          eventsWithVotes++;
        }
      } catch (error) {
        console.log(
          `   ⚠️  Failed to migrate MVP votes for ${eventId}: ${error.message}`,
        );
      }
    }

    if (!dryRun) {
      console.log(
        `   ✅ Migrated ${votesMigrated} MVP votes from ${eventsWithVotes} events\n`,
      );
    } else {
      console.log(
        `   [DRY RUN] Would migrate ${votesMigrated} MVP votes from ${eventsWithVotes} events\n`,
      );
    }

    // Summary
    console.log("=== Summary ===");
    console.log(`Events: ${eventIds.size}`);
    console.log(`Match Reports: ${reportsMigrated}`);
    console.log(`MVP Votes: ${votesMigrated} (from ${eventsWithVotes} events)`);
    console.log("\n✅ Migration complete!");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Error:", message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
    if (redis) {
      await redis.quit();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
