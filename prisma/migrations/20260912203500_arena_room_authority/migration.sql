-- AlterTable
ALTER TABLE "ArenaMatch" ADD COLUMN     "roundId" TEXT,
ADD COLUMN     "verification" TEXT NOT NULL DEFAULT 'host-reported';

-- CreateTable
CREATE TABLE "ArenaRoom" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "hostMemberId" TEXT,
    "hostEpoch" INTEGER NOT NULL DEFAULT 1,
    "hostLeaseUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArenaRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArenaRoomMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinNonce" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "visible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ArenaRoomMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArenaRound" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishesAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ArenaRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArenaRoundParticipant" (
    "roundId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ArenaRoundParticipant_pkey" PRIMARY KEY ("roundId","memberId")
);

-- CreateTable
CREATE TABLE "ArenaHostChange" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "memberId" TEXT,
    "epoch" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArenaHostChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArenaRoom_code_key" ON "ArenaRoom"("code");

-- CreateIndex
CREATE INDEX "ArenaRoom_expiresAt_idx" ON "ArenaRoom"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArenaRoomMember_joinNonce_key" ON "ArenaRoomMember"("joinNonce");

-- CreateIndex
CREATE INDEX "ArenaRoomMember_roomId_userId_idx" ON "ArenaRoomMember"("roomId", "userId");

-- CreateIndex
CREATE INDEX "ArenaRoomMember_roomId_seenAt_idx" ON "ArenaRoomMember"("roomId", "seenAt");

-- CreateIndex
CREATE INDEX "ArenaRound_roomId_completedAt_idx" ON "ArenaRound"("roomId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArenaRoundParticipant_roundId_userId_key" ON "ArenaRoundParticipant"("roundId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ArenaHostChange_roomId_epoch_key" ON "ArenaHostChange"("roomId", "epoch");

-- CreateIndex
CREATE UNIQUE INDEX "ArenaMatch_roundId_key" ON "ArenaMatch"("roundId");

-- AddForeignKey
ALTER TABLE "ArenaRoomMember" ADD CONSTRAINT "ArenaRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ArenaRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaRound" ADD CONSTRAINT "ArenaRound_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ArenaRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaRoundParticipant" ADD CONSTRAINT "ArenaRoundParticipant_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ArenaRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaHostChange" ADD CONSTRAINT "ArenaHostChange_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ArenaRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
