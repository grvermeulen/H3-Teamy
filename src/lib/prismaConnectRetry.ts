import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { DbUnavailableError } from "./dbUnavailableError";

const TRANSIENT_PRISMA_CONNECT_CODES = new Set<string>([
  "P1001",
  "P1002",
  "P1017",
]);

/**
 * Bepaalt of een fout waarschijnlijk tijdelijk is (connectie/pool) en een nieuwe poging rechtvaardigt.
 *
 * @param error - Fout van Prisma, `pg` of een andere bron.
 * @returns `true` wanneer opnieuw proberen zinvol kan zijn.
 */
export function isTransientPostgresConnectError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_PRISMA_CONNECT_CODES.has(error.code);
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Prisma adapter / serverless: upstream Postgres unreachable (often transient).
    return (
      msg.includes("timeout exceeded when trying to connect") ||
      msg.includes("connection terminated") ||
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("read econnreset") ||
      msg.includes("upstream database") ||
      msg.includes("failed to connect")
    );
  }
  return false;
}

function computeBackoffMs(attemptIndex: number): number {
  const base = 100 * 2 ** attemptIndex;
  const jitter = Math.floor(Math.random() * 100);
  return Math.min(base + jitter, 2_000);
}

/**
 * Voert een Prisma-actie uit met beperkte herhaling bij tijdelijke connectiefouten (serverless/pool),
 * tot vier pogingen, zodat een eerste fout door een verouderde pool-connectie niet direct faalt.
 *
 * @param operationName - Korte naam voor breadcrumbs (bijv. `listEventRsvps`).
 * @param fn - Async functie die de query uitvoert.
 * @returns Resultaat van `fn`.
 * @throws {@link DbUnavailableError} wanneer alle pogingen falen met een als transient herkende connectiefout.
 * @throws De oorspronkelijke fout wanneer die niet als transient wordt gezien.
 */
export async function withPgConnectRetry<T>(
  operationName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const maxAttempts = 4;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const transient = isTransientPostgresConnectError(error);
      if (attempt < maxAttempts - 1 && transient) {
        Sentry.addBreadcrumb({
          category: "postgres",
          message: `Opnieuw proberen na tijdelijke DB-connectiefout: ${operationName}`,
          level: "warning",
          data: { attempt: attempt + 1, operationName },
        });
        await new Promise<void>((resolve) => {
          setTimeout(resolve, computeBackoffMs(attempt));
        });
        continue;
      }
      if (!transient) {
        throw error;
      }
      break;
    }
  }
  if (lastError !== undefined && isTransientPostgresConnectError(lastError)) {
    Sentry.captureException(lastError, {
      extra: { operationName, exhaustedRetries: true },
      tags: { db_connect: "exhausted" },
    });
    throw new DbUnavailableError();
  }
  throw lastError;
}
