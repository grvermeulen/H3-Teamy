-- CreateTable
CREATE TABLE IF NOT EXISTS "UserRole" (
    "userId" TEXT NOT NULL,
    "admin" BOOLEAN NOT NULL DEFAULT false,
    "trainer" BOOLEAN NOT NULL DEFAULT false,
    "player" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserRole_userId_fkey'
  ) THEN
    ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Set Arjen Pels as trainer (admin panel roles did not persist without durable storage).
INSERT INTO "UserRole" ("userId", "admin", "trainer", "player", "updatedAt")
SELECT u.id, false, true, true, CURRENT_TIMESTAMP
FROM "User" u
WHERE LOWER(TRIM(u."firstName")) = 'arjen'
  AND LOWER(TRIM(u."lastName")) = 'pels'
ON CONFLICT ("userId") DO UPDATE
SET "trainer" = true, "updatedAt" = CURRENT_TIMESTAMP;
