import type { ErrorEvent, EventHint } from "@sentry/core";
import { Prisma } from "@prisma/client";

const TRANSIENT_PRISMA_DEV_CONNECT_CODES = new Set(["P1001", "P1002", "P1017"]);

/**
 * Bepaalt of een Sentry-serverevent lokale ontwikkel-ruis is (Postgres niet bereikbaar)
 * en niet naar ingest gestuurd moet worden. Dekt ook `captureException` zonder request-URL
 * (bijv. NextAuth credentials `authorize`).
 *
 * @param event - Sentry-foutevent.
 * @param hint - Hint met oorspronkelijke exception.
 * @returns `true` wanneer het event genegeerd mag worden.
 */
export function shouldDropDevLocalhostDbNoiseForSentry(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const envTag = String(event.tags?.environment ?? event.environment ?? "");
  if (envTag !== "development") return false;

  const original = hint.originalException;
  if (
    original instanceof Prisma.PrismaClientKnownRequestError &&
    TRANSIENT_PRISMA_DEV_CONNECT_CODES.has(original.code)
  ) {
    return true;
  }

  const msg =
    (original instanceof Error ? original.message : "") +
    String(event.exception?.values?.[0]?.value ?? "");
  const lower = msg.toLowerCase();
  const looksLikeUnreachableLocalDb =
    lower.includes("can't reach database server") ||
    lower.includes("p1001") ||
    lower.includes("127.0.0.1:5432");
  if (!looksLikeUnreachableLocalDb) return false;

  const reqUrl = String(
    (event.request as { url?: string } | undefined)?.url ??
      event.tags?.url ??
      "",
  );
  return reqUrl.includes("localhost") || reqUrl.includes("127.0.0.1");
}
