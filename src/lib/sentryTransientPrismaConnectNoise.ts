import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { isTransientPostgresConnectError } from "./prismaConnectRetry";
import { isPrismaSchemaDriftError } from "./prismaSchemaDrift";

const TRANSIENT_PRISMA_KNOWN_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
]);

/**
 * Herkent Prisma-connectie- en schema-driftfouten die routes als 503 of retry afhandelen
 * en geen Sentry-issue mogen vormen (JAVASCRIPT-NEXTJS-55/58).
 *
 * @param error - Fout uit `catch`, `onRequestError` of Sentry-hint.
 * @returns `true` wanneer de melding verwachte DB-connectieruis is.
 */
export function isTransientPrismaConnectSentryNoise(error: unknown): boolean {
  if (isTransientPostgresConnectError(error)) return true;
  if (isPrismaSchemaDriftError(error)) return true;
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    TRANSIENT_PRISMA_KNOWN_CODES.has(error.code)
  );
}

function isSerializedTransientPrismaException(event: ErrorEvent): boolean {
  const values = event.exception?.values;
  if (!values?.length) return false;
  for (const value of values) {
    if (value.type !== "PrismaClientKnownRequestError") continue;
    const text = String(value.value ?? "").toLowerCase();
    if (
      text.includes("p1001") ||
      text.includes("p1002") ||
      text.includes("p1008") ||
      text.includes("p1017") ||
      text.includes("p2021") ||
      text.includes("p2022") ||
      text.includes("can't reach database server") ||
      text.includes("timeout exceeded when trying to connect") ||
      text.includes("connection terminated")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Bepaalt of een server-side Sentry-event een transient Prisma/Postgres-connectiefout is
 * (JAVASCRIPT-NEXTJS-58: lege `PrismaClientKnownRequestError`-titel) en niet naar ingest
 * gestuurd moet worden.
 *
 * @param event - Sentry-foutevent.
 * @param hint - Hint met oorspronkelijke exception.
 * @returns `true` wanneer het event genegeerd mag worden.
 */
export function shouldDropTransientPrismaConnectNoiseForSentry(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  if (isTransientPrismaConnectSentryNoise(hint.originalException)) return true;
  return isSerializedTransientPrismaException(event);
}
