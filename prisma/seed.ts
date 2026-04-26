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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function slugifyTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Mirrors `src/lib/eventId.ts#canonicalEventId` so seeded RSVPs match real iCal IDs. */
function canonicalEventId(title: string, start: Date | string): string {
  const d = start instanceof Date ? start : new Date(start);
  const slug = slugifyTitle(title);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}--${slug}`;
}

/**
 * Recent training dates relative to today: last ~6 Wed/Fri sessions plus the
 * next 2 upcoming ones. Bounded to the season window (SEASON_START..SEASON_END)
 * if those env vars are set, otherwise unbounded.
 */
function recentTrainingDates(): string[] {
  const now = new Date();
  const out: string[] = [];
  // Six weeks back to two weeks forward, pick Wednesdays (3) and Fridays (5).
  const start = new Date(now);
  start.setDate(start.getDate() - 6 * 7);
  const end = new Date(now);
  end.setDate(end.getDate() + 2 * 7);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const w = d.getDay();
    if (w === 3 || w === 5) out.push(toYMD(new Date(d)));
  }
  return out;
}

type SeedEvent = {
  id: string;
  uid?: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
  description?: string;
};

/**
 * Synthetic match calendar used when Sportlink returns nothing (off-season,
 * cron not run yet). The events page in `src/lib/ical.ts` merges the Redis
 * cache key `calendar:events:v1` with the live iCal feed, so seeding into
 * that cache guarantees the events appear without faking the iCal source.
 */
function syntheticEvents(): SeedEvent[] {
  const now = new Date();
  const slots: { offsetDays: number; title: string; location?: string }[] = [
    { offsetDays: -14, title: "H3 - DZV (uit)", location: "Wassenaar" },
    { offsetDays: -7, title: "H3 - PSV (thuis)", location: "De Rijn" },
    { offsetDays: 3, title: "H3 - WZK (uit)", location: "Katwijk" },
    { offsetDays: 10, title: "H3 - ZIAN (thuis)", location: "De Rijn" },
    { offsetDays: 17, title: "H3 - HZPC (thuis)", location: "De Rijn" },
    { offsetDays: 24, title: "H3 - LZ&PC (uit)", location: "Leiden" },
  ];
  return slots.map(({ offsetDays, title, location }) => {
    const start = new Date(now);
    start.setDate(start.getDate() + offsetDays);
    start.setHours(20, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 1, 30);
    return {
      id: canonicalEventId(title, start),
      uid: `seed-${canonicalEventId(title, start)}`,
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      location,
    };
  });
}

/** Fetches events from the Sportlink iCal so seeded RSVPs match what the UI shows. */
async function fetchSportlinkEvents(): Promise<SeedEvent[]> {
  const url = process.env.SPORTLINK_ICAL_URL;
  if (!url) {
    console.log("SPORTLINK_ICAL_URL not set — skipping RSVP seed.");
    return [];
  }
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(
        `Sportlink fetch failed (${res.status}); skipping RSVP seed.`,
      );
      return [];
    }
    const text = await res.text();
    const icalMod = (await import("ical")) as unknown as {
      parseICS?: (s: string) => unknown;
      default?: { parseICS: (s: string) => unknown };
    };
    const parseICS = icalMod.parseICS ?? icalMod.default?.parseICS;
    if (!parseICS) {
      console.warn("ical.parseICS not available; skipping RSVP seed.");
      return [];
    }
    const data = parseICS(text) as Record<
      string,
      { type?: string; summary?: unknown; start?: unknown }
    >;
    return Object.values(data)
      .filter((c) => c?.type === "VEVENT")
      .map((evt) => {
        const title = String(evt.summary ?? "Match");
        const startIso =
          evt.start instanceof Date
            ? evt.start.toISOString()
            : new Date(evt.start as string | number).toISOString();
        return {
          id: canonicalEventId(title, startIso),
          title,
          start: startIso,
        };
      })
      .sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
      );
  } catch (err) {
    console.warn(
      `Sportlink fetch threw (${(err as Error).message}); skipping RSVP seed.`,
    );
    return [];
  }
}

/**
 * Deterministic per-(user, event) RSVP so re-runs upsert the same value.
 * Distribution roughly: 60% yes, 20% maybe, 20% no — trainer always yes.
 */
function rsvpFor(userEmail: string, eventId: string): "yes" | "no" | "maybe" {
  if (userEmail === "trainer@example.test") return "yes";
  let h = 0;
  const key = `${userEmail}|${eventId}`;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const bucket = ((h % 100) + 100) % 100;
  if (bucket < 60) return "yes";
  if (bucket < 80) return "maybe";
  return "no";
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
      `Upserted ${created.length} users. Login: trainer@example.test / ${TRAINER_PASSWORD}`,
    );

    const today = toYMD(new Date());
    const trainingDates = recentTrainingDates();
    let attendanceCount = 0;
    for (const date of trainingDates) {
      // Only mark attendance on past sessions; future sessions stay empty so
      // the trainer can fill them in to test the flow.
      if (date >= today) continue;
      // Vary present count per session to make the badge histogram realistic.
      let bucket = 0;
      for (const ch of date) bucket = (bucket * 31 + ch.charCodeAt(0)) | 0;
      const presentCount = 4 + (Math.abs(bucket) % (created.length - 2));
      const present = created.slice(0, presentCount);
      for (const u of present) {
        await prisma.attendance.upsert({
          where: { date_userId: { date, userId: u.id } },
          update: {},
          create: { date, userId: u.id, markedBy: created[0].id },
        });
        attendanceCount++;
      }
    }
    console.log(
      `Upserted ${attendanceCount} attendance rows across ${trainingDates.filter((d) => d < today).length} past sessions.`,
    );

    const sportlinkEvents = await fetchSportlinkEvents();
    const events =
      sportlinkEvents.length > 0 ? sportlinkEvents : syntheticEvents();
    const eventSource =
      sportlinkEvents.length > 0 ? "Sportlink" : "synthetic (Sportlink empty)";
    console.log(`Using ${events.length} events from ${eventSource}.`);

    // Push synthetic events into the Redis cache the events page reads from
    // so the UI shows them. Sportlink data overlays this on next fetch.
    if (sportlinkEvents.length === 0) {
      const redisUrl =
        process.env.PREVIEW_REDIS_URL || process.env.REDIS_URL || "";
      if (redisUrl) {
        try {
          const { default: IORedis } = await import("ioredis");
          const redis = new IORedis(redisUrl, {
            lazyConnect: true,
            maxRetriesPerRequest: 2,
          });
          await redis.connect();
          await redis.set("calendar:events:v1", JSON.stringify(events));
          await redis.quit();
          console.log(
            `Wrote ${events.length} synthetic events to Redis (calendar:events:v1).`,
          );
        } catch (err) {
          console.warn(
            `Redis write failed (${(err as Error).message}); RSVPs will exist in DB but events page may not show them until Sportlink returns events.`,
          );
        }
      }
    }

    const nowMs = Date.now();
    const upcoming = events
      .filter((e) => new Date(e.start).getTime() >= nowMs - 7 * 86400_000)
      .slice(0, 6);
    const past = events
      .filter((e) => new Date(e.start).getTime() < nowMs - 7 * 86400_000)
      .slice(-3);
    const targetEvents = [...past, ...upcoming];

    // Rsvp.eventId has a FK on Event(id) (migration 20251222195742_add_events_models)
    // even though schema.prisma doesn't model the Event table. Upsert via raw SQL.
    for (const evt of targetEvents) {
      await prisma.$executeRaw`
        INSERT INTO "Event" ("id", "createdAt", "updatedAt", "title", "startDate", "endDate")
        VALUES (
          ${evt.id},
          NOW(),
          NOW(),
          ${evt.title},
          ${new Date(evt.start)},
          ${evt.end ? new Date(evt.end) : null}
        )
        ON CONFLICT ("id") DO UPDATE SET
          "title" = EXCLUDED."title",
          "startDate" = EXCLUDED."startDate",
          "endDate" = EXCLUDED."endDate",
          "updatedAt" = NOW()
      `;
    }

    let rsvpCount = 0;
    for (const evt of targetEvents) {
      for (const u of created) {
        const status = rsvpFor(u.email, evt.id);
        await prisma.rsvp.upsert({
          where: { userId_eventId: { userId: u.id, eventId: evt.id } },
          update: { status },
          create: { userId: u.id, eventId: evt.id, status },
        });
        rsvpCount++;
      }
    }
    console.log(
      `Upserted ${rsvpCount} RSVPs across ${targetEvents.length} events (${past.length} past, ${upcoming.length} upcoming).`,
    );

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
