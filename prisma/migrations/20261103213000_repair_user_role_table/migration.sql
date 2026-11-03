-- Preview leftovers: an unused enum named UserRole (CUSTOMER/ADMIN) collides
-- with the UserRole table from 20260904193000_add_user_role. Only drop the
-- enum when no table of that name exists — never touch a live UserRole table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'UserRole'
      AND t.typtype = 'e'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'UserRole'
      AND c.relkind = 'r'
  ) THEN
    DROP TYPE "UserRole";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "UserRole" (
    "userId" TEXT NOT NULL,
    "admin" BOOLEAN NOT NULL DEFAULT false,
    "trainer" BOOLEAN NOT NULL DEFAULT false,
    "player" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserRole_userId_fkey'
  ) THEN
    ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
