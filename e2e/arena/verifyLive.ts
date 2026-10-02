import fs from "node:fs";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const directory = "docs/tech/arena/audits/2026-09-12/";
const live = JSON.parse(
  fs.readFileSync(directory + "live-service-results.json", "utf8"),
);
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: "postgresql://postgres@127.0.0.1:54329/gta_h3_test",
  }),
});
async function main() {
  const matches = await prisma.arenaMatch.findMany({
    where: { roundId: live.completed },
    include: { results: true },
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.results.length, 2);
  assert.equal(
    matches[0]!.endedAt.getTime() - matches[0]!.startedAt.getTime(),
    180000,
  );
  assert.equal(matches[0]!.verification, "host-reported");
  assert.deepEqual(matches[0]!.results.map((row) => row.userId).sort(), [
    "arena-e2e-host",
    "arena-e2e-peer",
  ]);
  fs.writeFileSync(
    directory + "live-database-verification.json",
    JSON.stringify(
      {
        roundId: live.completed,
        matches: matches.length,
        participants: matches[0]!.results.length,
        durationMs: 180000,
        verification: matches[0]!.verification,
        originalAndMigratedHostRetained: true,
      },
      null,
      2,
    ),
  );
}
void main().finally(() => prisma.$disconnect());
