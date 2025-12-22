/*
  Baseline existing migrations - mark them as already applied.
  This is needed when the database already has tables but Prisma doesn't know which migrations were applied.
  Usage: DIRECT_DATABASE_URL=... node scripts/baseline-migrations.js
*/

require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

async function main() {
  // Ensure DATABASE_URL is set from DIRECT_DATABASE_URL if needed
  if (!process.env.DATABASE_URL && process.env.DIRECT_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
  }

  const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ DIRECT_DATABASE_URL or DATABASE_URL must be set");
    process.exit(1);
  }

  console.log("Connecting to database...\n");
  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Migrations that are already applied (based on existing tables)
    const migrationsToBaseline = [
      "0_init",
      "20240101000000_init",
      "20251220005000_add_attendance",
      "20251220005611_add_attendance_model",
    ];

    console.log("=== Baseline Existing Migrations ===\n");
    console.log(
      `Marking ${migrationsToBaseline.length} migrations as applied...\n`,
    );

    for (const migrationName of migrationsToBaseline) {
      try {
        // Check if migration table exists
        const result = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = '_prisma_migrations'
          );
        `);

        if (!result.rows[0].exists) {
          // Create migrations table if it doesn't exist
          await pool.query(`
            CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
              "id" VARCHAR(36) PRIMARY KEY,
              "checksum" VARCHAR(64) NOT NULL,
              "finished_at" TIMESTAMP(3),
              "migration_name" VARCHAR(255) NOT NULL,
              "logs" TEXT,
              "rolled_back_at" TIMESTAMP(3),
              "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "applied_steps_count" INTEGER NOT NULL DEFAULT 0
            );
          `);
          console.log("✅ Created _prisma_migrations table");
        }

        // Check if migration is already recorded
        const existing = await pool.query(
          `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1`,
          [migrationName],
        );

        if (existing.rows.length > 0) {
          console.log(
            `⏭️  Migration ${migrationName} already marked as applied`,
          );
        } else {
          // Insert migration record
          const migrationId = require("crypto").randomUUID();
          await pool.query(
            `INSERT INTO "_prisma_migrations" (id, migration_name, checksum, started_at, finished_at, applied_steps_count) 
             VALUES ($1, $2, $3, NOW(), NOW(), 1)`,
            [migrationId, migrationName, "baselined"],
          );
          console.log(`✅ Marked ${migrationName} as applied`);
        }
      } catch (error) {
        console.error(`❌ Error baselining ${migrationName}:`, error.message);
      }
    }

    console.log("\n✅ Baseline complete!");
    console.log("\nYou can now run: npx prisma migrate deploy");
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
