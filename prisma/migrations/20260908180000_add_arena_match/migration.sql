-- CreateTable
CREATE TABLE "ArenaMatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roomCode" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "hostUserId" TEXT,

    CONSTRAINT "ArenaMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArenaMatchResult" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kills" INTEGER NOT NULL,
    "deaths" INTEGER NOT NULL,
    "won" BOOLEAN NOT NULL,

    CONSTRAINT "ArenaMatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArenaMatch_createdAt_idx" ON "ArenaMatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArenaMatch_roomCode_startedAt_key" ON "ArenaMatch"("roomCode", "startedAt");

-- CreateIndex
CREATE INDEX "ArenaMatchResult_userId_idx" ON "ArenaMatchResult"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ArenaMatchResult_matchId_userId_key" ON "ArenaMatchResult"("matchId", "userId");

-- AddForeignKey
ALTER TABLE "ArenaMatchResult" ADD CONSTRAINT "ArenaMatchResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "ArenaMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaMatchResult" ADD CONSTRAINT "ArenaMatchResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
