-- Align database with Prisma schema: column was referenced by deployed clients but missing from migrated DBs.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastVersionSeen" TEXT;
