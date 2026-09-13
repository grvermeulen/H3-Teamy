const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const bcrypt = require("bcryptjs");
const client = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: "postgresql://postgres@127.0.0.1:54329/gta_h3_test",
  }),
});
(async () => {
  for (const role of ["host", "peer"]) {
    const id = `arena-e2e-${role}`;
    await client.user.upsert({
      where: { id },
      create: {
        id,
        email: `${role}@arena.example.test`,
        firstName: role === "host" ? "Audit Host" : "Audit Speler",
        lastName: "Test",
        passwordHash: await bcrypt.hash("arena-local-test-2026", 10),
      },
      update: {},
    });
    await client.userRole.upsert({
      where: { userId: id },
      create: {
        userId: id,
        admin: role === "host",
        trainer: false,
        player: true,
      },
      update: {},
    });
  }
  await client.featureFlag.upsert({
    where: { key: "feature:gta-h3-launcher" },
    create: {
      key: "feature:gta-h3-launcher",
      enabled: true,
      updatedBy: "arena-e2e-host",
    },
    update: { enabled: true },
  });
  console.log("Two isolated arena accounts and launcher ready");
})().finally(() => client.$disconnect());
