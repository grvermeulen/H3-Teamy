/*
  Deletes users with no identities and no RSVPs.
  Usage:
    DATABASE_URL=... node scripts/cleanup-orphans.js
*/

const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const before = await prisma.user.count({ where: { identities: { none: {} }, rsvps: { none: {} } } });
    console.log(`Orphans before: ${before}`);
    const res = await prisma.user.deleteMany({ where: { identities: { none: {} }, rsvps: { none: {} } } });
    console.log(`Deleted: ${res.count}`);
    const after = await prisma.user.count({ where: { identities: { none: {} }, rsvps: { none: {} } } });
    console.log(`Orphans after: ${after}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



