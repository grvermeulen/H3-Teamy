ALTER TABLE "ArenaMatch" ADD COLUMN "scoringVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ArenaRoom" ADD COLUMN "protocolVersion" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "ArenaRound" ADD COLUMN "scoringVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ArenaMatchResult"
  ADD COLUMN "cashEarned" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "missionsCompleted" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scoringVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "receipts" JSONB NOT NULL DEFAULT '[]';
UPDATE "ArenaMatchResult" SET "score" = "kills";
CREATE INDEX "ArenaMatchResult_scoringVersion_idx" ON "ArenaMatchResult"("scoringVersion");
