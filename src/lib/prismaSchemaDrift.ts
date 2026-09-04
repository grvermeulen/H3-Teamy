import { Prisma } from "@prisma/client";
import { DbUnavailableError } from "./dbUnavailableError";

/**
 * Detecteert wanneer Postgres het Prisma-schema nog niet heeft (bijv. migratie niet uitgevoerd).
 *
 * @param error - Fout uit een `catch`-blok of een geworpen Prisma-fout.
 * @returns `true` bij ontbrekende tabel (`P2021`) of kolom (`P2022`).
 */
export function isPrismaSchemaDriftError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}

/**
 * Voert een Prisma-query uit en zet schema-drift om naar {@link DbUnavailableError},
 * zodat API-routes dezelfde `503`-respons kunnen geven als bij connectieproblemen.
 *
 * @param fn - Async functie die de database aanroept.
 * @returns Het resultaat van `fn`.
 * @throws {@link DbUnavailableError} wanneer de database het verwachte schema mist.
 */
export async function withPrismaSchemaDriftAsDbUnavailable<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (isPrismaSchemaDriftError(error)) {
      throw new DbUnavailableError();
    }
    throw error;
  }
}
