/**
 * Normaliseert browser fetch-foutteksten (o.a. `TypeError:`-prefix, host tussen haakjes).
 *
 * @param raw - Ruwe exception- of eventtekst.
 * @returns Genormaliseerde kernmelding.
 */
export function normalizeBenignClientFetchMessage(raw: string): string {
  return raw
    .trim()
    .replace(/^TypeError:\s*/i, "")
    .trim();
}

/**
 * Herkent genormaliseerde fetch-foutteksten van bekende tijdelijke netwerkafwijzingen.
 *
 * @param message - Ruwe melding (event value, Error.message, enz.).
 * @returns `true` wanneer dit verwachte client-side fetch-ruis is.
 */
export function isBenignTransientClientFetchMessage(message: string): boolean {
  const msg = normalizeBenignClientFetchMessage(message);
  if (
    msg === "Load failed" ||
    msg === "Failed to fetch" ||
    msg === "NetworkError when attempting to fetch resource." ||
    msg === "A network error occurred."
  ) {
    return true;
  }
  if (/^Load failed\s+\([^)]+\)$/.test(msg)) {
    return true;
  }
  if (/^Failed to fetch\s+\([^)]+\)$/.test(msg)) {
    return true;
  }
  return false;
}

/**
 * Herkent browser-specifieke fetch-afwijzingen door tijdelijke netwerkproblemen
 * (offline, tab-suspension, navigatie tijdens request). Geen applicatiebug.
 */
export function isBenignTransientClientFetchError(error: unknown): boolean {
  if (typeof error === "string") {
    return isBenignTransientClientFetchMessage(error);
  }

  if (error instanceof DOMException && error.name === "NetworkError") {
    return true;
  }

  if (error instanceof TypeError) {
    return isBenignTransientClientFetchMessage(error.message);
  }

  if (error instanceof Error) {
    if (isBenignTransientClientFetchMessage(error.message)) {
      return true;
    }
    if (error.cause !== undefined) {
      return isBenignTransientClientFetchError(error.cause);
    }
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return isBenignTransientClientFetchMessage(
      (error as { message: string }).message,
    );
  }

  return false;
}
