import { Prisma } from "@prisma/client";

/**
 * Leest de Prisma known-request code uit een exception, ook wanneer Sentry/Next.js
 * de prototype-keten kwijtraakt (plain object met `code`).
 *
 * @param error - Fout uit `catch`, Sentry-hint of `onRequestError`.
 * @returns Prisma-code (bijv. `P1001`) of `undefined`.
 */
export function readPrismaKnownRequestCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
