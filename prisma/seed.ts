/**
 * Idempotent dummy data for the preview database.
 *
 * Safe to run multiple times: every record is upserted by a stable key.
 * Refuses to run against production-looking URLs unless `ALLOW_SEED_PROD=1`.
 *
 * Usage:
 *   npm run db:seed          # uses DATABASE_URL from process env
 *   npm run db:seed:preview  # pulls preview env first, then seeds
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

/**
 * Predictable login for the trainer account so anyone can sign into preview.
 * Override with `SEED_TRAINER_PASSWORD=…` if you want a stronger value.
 * Only ever runs against non-production envs (see `assertNonProd`).
 */
const TRAINER_PASSWORD = process.env.SEED_TRAINER_PASSWORD || "preview123";

const SEASON_DATES = [
  "2025-09-22",
  "2025-09-29",
  "2025-10-06",
  "2025-10-13",
  "2025-10-20",
  "2025-10-27",
  "2025-11-03",
  "2025-11-10",
  "2025-11-17",
  "2025-11-24",
];

const USERS = [
  { firstName: "Test", lastName: "Trainer", email: "trainer@example.test" },
  { firstName: "Alex", lastName: "Aandracht", email: "alex@example.test" },
  { firstName: "Bram", lastName: "Bal", email: "bram@example.test" },
  { firstName: "Cas", lastName: "Coach", email: "cas@example.test" },
  { firstName: "Daan", lastName: "Doel", email: "daan@example.test" },
  { firstName: "Eelco", lastName: "Eind", email: "eelco@example.test" },
  { firstName: "Finn", lastName: "Flank", email: "finn@example.test" },
  { firstName: "Guus", lastName: "Goal", email: "guus@example.test" },
];

const PROD_TENANT =
  "e7fcde367d223f28991c47fe9d7da827fd1277513b2c7ec8f72bc1e82bd63a8e";

function assertNonProd(url: string) {
  if (process.env.ALLOW_SEED_PROD === "1") return;
  if (!url) {
    throw new Error(
      "No database URL found. Set PREVIEW_DATABASE_URL or DATABASE_URL.",
    );
  }
  if (
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_TARGET_ENV === "production"
  ) {
    throw new Error(
      "Refusing to seed: VERCEL_*ENV is production. Set ALLOW_SEED_PROD=1 to override.",
    );
  }
  if (url.includes(PROD_TENANT)) {
    throw new Error(
      "Refusing to seed: URL points at the production Prisma Postgres tenant. Set ALLOW_SEED_PROD=1 to override.",
    );
  }
}

async function main() {
  const url =
    process.env.PREVIEW_POSTGRES_PRISMA_URL ||
    process.env.PREVIEW_DATABASE_URL ||
    process.env.PREVIEW_POSTGRES_URL ||
    process.env.PRISMA_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    "";
  assertNonProd(url);

  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  try {
    const trainerHash = await bcrypt.hash(TRAINER_PASSWORD, 10);
    const created = [] as { id: string; email: string }[];
    for (const u of USERS) {
      const passwordHash =
        u.email === "trainer@example.test" ? trainerHash : null;
      const row = await prisma.user.upsert({
        where: { email: u.email },
        update: {
          firstName: u.firstName,
          lastName: u.lastName,
          ...(passwordHash ? { passwordHash } : {}),
        },
        create: { ...u, ...(passwordHash ? { passwordHash } : {}) },
      });
      created.push({ id: row.id, email: row.email ?? "" });
    }
    console.log(
      `Upserted ${created.length} users. Trainer login: trainer@example.test.`,
    );

    let attendanceCount = 0;
    for (const date of SEASON_DATES) {
      const present = created.slice(0, Math.max(3, created.length - 2));
      for (const u of present) {
        await prisma.attendance.upsert({
          where: { date_userId: { date, userId: u.id } },
          update: {},
          create: { date, userId: u.id, markedBy: created[0].id },
        });
        attendanceCount++;
      }
    }
    console.log(`Upserted ${attendanceCount} attendance rows.`);

    const sampleFeedback = [
      {
        userEmail: "alex@example.test",
        type: "BUG" as const,
        title: "RSVP knop reageert traag op iPhone",
        body: "Op iPhone 13 duurt het 2-3 seconden voor de status verandert.",
        route: "/rsvp",
      },
      {
        userEmail: "bram@example.test",
        type: "IDEA" as const,
        title: "Push-notificatie wanneer training afgelast is",
        body: "Zou handig zijn om automatisch een melding te krijgen.",
        route: "/training",
      },
    ];

    for (const f of sampleFeedback) {
      const user = created.find((u) => u.email === f.userEmail);
      if (!user) continue;
      const exists = await prisma.feedback.findFirst({
        where: { userId: user.id, title: f.title },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.feedback.create({
        data: {
          userId: user.id,
          type: f.type,
          title: f.title,
          body: f.body,
          route: f.route,
        },
      });
    }
    console.log(`Sample feedback ensured (${sampleFeedback.length} items).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
