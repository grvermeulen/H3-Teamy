/**
 * Herkent browser-specifieke fetch-afwijzingen door tijdelijke netwerkproblemen
 * (offline, tab-suspension, navigatie tijdens request). Geen applicatiebug.
 */
export function isBenignTransientClientFetchError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "NetworkError") {
    return true;
  }

  if (error instanceof TypeError) {
    const msg = error.message.trim();
    if (
      msg === "Load failed" ||
      msg === "Failed to fetch" ||
      msg === "NetworkError when attempting to fetch resource."
    ) {
      return true;
    }
  }

  if (error instanceof Error) {
    const msg = error.message.trim();
    if (msg === "A network error occurred.") {
      return true;
    }
  }

  if (error instanceof Error && error.cause !== undefined) {
    return isBenignTransientClientFetchError(error.cause);
  }

  return false;
}
