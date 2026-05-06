import { Prisma } from "@prisma/client";
import { DbUnavailableError } from "./dbUnavailableError";

/**
 * Wanneer de Passkey-tabel ontbreekt (bijv. migratie niet op preview-DB), zet Prisma P2021
 * om naar {@link DbUnavailableError} zodat API-routes 503 teruggeven i.p.v. Sentry 500.
 *
 * @param error - Fout uit een `catch`-blok rond `prisma.passkey`-aanroepen.
 * @throws {DbUnavailableError} Bij Prisma-code P2021 wanneer het foutbericht de Passkey-tabel noemt.
 */
export function throwIfPasskeyTableMissing(error: unknown): void {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021" &&
    error.message.includes("Passkey")
  ) {
    throw new DbUnavailableError();
  }
}
