-- Idempotent where possible: preview DBs may already have objects from earlier branches.

DO $$
BEGIN
  CREATE TYPE "FeedbackType" AS ENUM ('BUG', 'IDEA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'TRIAGED', 'PLANNED', 'SHIPPED', 'DECLINED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastVersionSeen" TEXT;

CREATE TABLE IF NOT EXISTS "Feedback" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "route" TEXT,
    "appVersion" TEXT,
    "userAgent" TEXT,
    "aiTheme" TEXT,
    "aiImpact" TEXT,
    "aiSummary" TEXT,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Feedback_type_createdAt_idx" ON "Feedback"("type", "createdAt");

CREATE INDEX IF NOT EXISTS "Feedback_userId_idx" ON "Feedback"("userId");

CREATE INDEX IF NOT EXISTS "Feedback_status_idx" ON "Feedback"("status");

DO $$
BEGIN
  ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
