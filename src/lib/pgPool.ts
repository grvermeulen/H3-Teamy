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
 * Parses a positive duration in milliseconds from env, or returns `fallback`.
 * @param value - Raw string (e.g. from `process.env.PG_CONNECTION_TIMEOUT_MS`).
 * @param fallback - Used when missing, NaN, or non-positive.
 */
function parsePositiveMs(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Builds `pg.Pool` options for Prisma’s driver adapter.
 * Uses a small `max` on Vercel (default **1**) so each serverless instance opens few TCP connections;
 * many instances × many connections per instance exhausts Postgres and surfaces as connection timeouts.
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
  keepAlive: boolean;
  keepAliveInitialDelayMillis: number;
  maxLifetimeSeconds: number;
} {
  const onVercel = process.env.VERCEL === "1";
  const max = parsePositiveInt(process.env.PG_POOL_MAX, onVercel ? 1 : 20);
  const connectionTimeoutMillis = parsePositiveMs(
    process.env.PG_CONNECTION_TIMEOUT_MS,
    20_000,
  );
  const idleTimeoutMillis = parsePositiveMs(
    process.env.PG_IDLE_TIMEOUT_MS,
    20_000,
  );
  /** Recycle pooled connections so idle TCP sessions dropped by NAT/LB are not reused (avoids "Connection terminated unexpectedly"). */
  const maxLifetimeSeconds = parsePositiveInt(
    process.env.PG_POOL_MAX_LIFETIME_SECONDS,
    onVercel ? 300 : 0,
  );
  /** First TCP keepalive probe delay (`pg` passes this to libpq as `keepalives_idle`). */
  const keepAliveInitialDelayMillis = parsePositiveMs(
    process.env.PG_KEEPALIVE_INITIAL_DELAY_MS,
    10_000,
  );
  return {
    connectionString,
    max,
    min: 0,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    allowExitOnIdle: onVercel,
    keepAlive: true,
    keepAliveInitialDelayMillis,
    maxLifetimeSeconds,
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
