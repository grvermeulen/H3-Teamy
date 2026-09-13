ALTER TABLE "ArenaRoomMember" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "ArenaRoomMember"
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'player',
  ADD COLUMN "device" TEXT NOT NULL DEFAULT 'desktop',
  ADD COLUMN "displayKeyHash" TEXT;
CREATE INDEX "ArenaRoomMember_displayKeyHash_idx" ON "ArenaRoomMember"("displayKeyHash");
ALTER TABLE "ArenaRoomMember" ADD CONSTRAINT "ArenaRoomMember_role_check"
  CHECK ("role" IN ('player', 'controller', 'hybrid', 'display'));
ALTER TABLE "ArenaRoomMember" ADD CONSTRAINT "ArenaRoomMember_identity_check"
  CHECK (("role" = 'display' AND "userId" IS NULL AND "displayKeyHash" IS NOT NULL)
    OR ("role" <> 'display' AND "userId" IS NOT NULL AND "displayKeyHash" IS NULL));
