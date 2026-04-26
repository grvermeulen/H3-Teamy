import { NextResponse } from "next/server";

/**
 * Fout wanneer Postgres na herhaalde pogingen nog steeds niet bereikbaar is.
 * API-routes kunnen hierop `503` teruggeven i.p.v. een onafgehandelde 500.
 */
export class DbUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(message = "Database tijdelijk niet beschikbaar") {
    super(message);
    this.name = "DbUnavailableError";
  }
}

/**
 * @param error - Waarde uit een `catch`-blok of een geworpen fout.
 * @returns `true` wanneer de fout een {@link DbUnavailableError} is.
 */
export function isDbUnavailableError(
  error: unknown,
): error is DbUnavailableError {
  return error instanceof DbUnavailableError;
}

/**
 * Standaard JSON-respons wanneer de database (tijdelijk) niet bereikbaar is.
 */
export function jsonDatabaseUnavailable(): NextResponse {
  return NextResponse.json(
    {
      error: "Database tijdelijk niet beschikbaar. Probeer het later opnieuw.",
    },
    { status: 503 },
  );
}
