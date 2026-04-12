import * as Sentry from "@sentry/nextjs";

/**
 * Parses a positive integer from an env value, or returns `fallback`.
 * @param value - Raw string (e.g. from `process.env.PG_POOL_MAX`).
 * @param fallback - Used when missing, NaN, or non-positive.
 */
function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Builds `pg.Pool` options for Prisma’s driver adapter.
 * Uses a modest `max` on Vercel to avoid opening one TCP connection per request (which can exhaust Postgres or stall with `ETIMEDOUT`).
 *
 * @param connectionString - Postgres URL (`DATABASE_URL` / `PRISMA_DATABASE_URL`).
 * @returns Pool configuration passed to `@prisma/adapter-pg` (internally builds a `pg.Pool`).
 */
export function getPgPoolConfig(connectionString: string): {
  connectionString: string;
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  allowExitOnIdle: boolean;
} {
  const onVercel = process.env.VERCEL === "1";
  const max = parsePositiveInt(process.env.PG_POOL_MAX, onVercel ? 5 : 20);
  return {
    connectionString,
    max,
    min: 0,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: onVercel,
  };
}

/**
 * Options for `@prisma/adapter-pg`: log pool errors without relying on a raw `pg.Pool` instance (avoids duplicate `@types/pg` clashes with the adapter bundle).
 */
export function getPrismaPgAdapterOptions(): {
  onPoolError: (err: Error) => void;
} {
  return {
    onPoolError: (err: Error) => {
      Sentry.captureException(err, { tags: { component: "pg-pool" } });
    },
  };
}
