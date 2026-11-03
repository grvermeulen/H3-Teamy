-- CreateTable
CREATE TABLE "SpeelboekDrill" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "content" JSONB NOT NULL,

    CONSTRAINT "SpeelboekDrill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingProgramItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" TEXT NOT NULL,
    "drillId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "minutes" INTEGER,
    "note" TEXT,

    CONSTRAINT "TrainingProgramItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrillAck" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drillId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "DrillAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrillQuestion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drillId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DrillQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpeelboekDrill_published_category_idx" ON "SpeelboekDrill"("published", "category");

-- CreateIndex
CREATE INDEX "TrainingProgramItem_date_idx" ON "TrainingProgramItem"("date");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProgramItem_date_drillId_key" ON "TrainingProgramItem"("date", "drillId");

-- CreateIndex
CREATE INDEX "DrillAck_drillId_idx" ON "DrillAck"("drillId");

-- CreateIndex
CREATE UNIQUE INDEX "DrillAck_drillId_userId_key" ON "DrillAck"("drillId", "userId");

-- CreateIndex
CREATE INDEX "DrillQuestion_drillId_resolvedAt_idx" ON "DrillQuestion"("drillId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "DrillAck" ADD CONSTRAINT "DrillAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillQuestion" ADD CONSTRAINT "DrillQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
