import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { DbUnavailableError } from "./dbUnavailableError";

const TRANSIENT_PRISMA_CONNECT_CODES = new Set<string>([
  "P1001",
  "P1002",
  "P1017",
]);

const PRISMA_CREDENTIAL_ERROR_CODES = new Set<string>(["P1000"]);

/**
 * Bepaalt of een fout waarschijnlijk tijdelijk is (connectie/pool) en een nieuwe poging rechtvaardigt.
 *
 * @param error - Fout van Prisma, `pg` of een andere bron.
 * @returns `true` wanneer opnieuw proberen zinvol kan zijn.
 */
/**
 * Bepaalt of een Prisma-fout door ongeldige DB-credentials komt (bijv. preview zonder juiste DATABASE_URL).
 *
 * @param error - Fout van Prisma of een andere bron.
 * @returns `true` wanneer authenticatie/credentials de oorzaak lijken.
 */
export function isPrismaCredentialError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return PRISMA_CREDENTIAL_ERROR_CODES.has(error.code);
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("authentication failed against the database server") ||
      msg.includes("provided database credentials") ||
      msg.includes("password authentication failed")
    );
  }
  return false;
}

/**
 * Bepaalt of een Prisma-leesactie naar Redis/KV/in-memory mag terugvallen i.p.v. falen.
 *
 * @param error - Fout uit `withPgConnectRetry` of een directe Prisma-query.
 * @returns `true` wanneer fallback veilig is (connectie, credentials of {@link DbUnavailableError}).
 */
export function shouldFallbackFromPrismaToKv(error: unknown): boolean {
  return (
    error instanceof DbUnavailableError ||
    isTransientPostgresConnectError(error) ||
    isPrismaCredentialError(error)
  );
}

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
      msg.includes("failed to connect") ||
      msg.includes("can't reach database server") ||
      msg.includes("could not connect to server") ||
      msg.includes("error while reading client passwordmessage")
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
    Sentry.addBreadcrumb({
      category: "postgres",
      message: `DB-connectie na herhaalde pogingen mislukt: ${operationName}`,
      level: "warning",
      data: { operationName, exhaustedRetries: true },
    });
    throw new DbUnavailableError();
  }
  throw lastError;
}
