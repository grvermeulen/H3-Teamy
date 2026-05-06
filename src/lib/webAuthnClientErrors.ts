/**
 * WebAuthn-specifieke foutdetectie voor client-side flows (`startAuthentication`,
 * `startRegistration`). Zie W3C WebAuthn privacy considerations — veel browsers
 * gooien `NotAllowedError` bij annuleren, timeout of geweigerde biometrie.
 */

const MAX_CAUSE_DEPTH = 4;

/**
 * Bepaalt of een fout een verwachte gebruikersactie weerspiegelt (prompt
 * sluiten, timeout, geweigerde authenticatie) i.p.v. een applicatiebug.
 *
 * @param error - Waarde uit een `catch`-blok rond WebAuthn-browser-API's.
 * @returns `true` voor typische annulering/timeout (`NotAllowedError`,
 *   `AbortError`), inclusief wanneer die als `cause` op een wrapper-`Error` zit.
 */
export function isBenignWebAuthnClientError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth++) {
    if (current instanceof DOMException) {
      if (
        current.name === "NotAllowedError" ||
        current.name === "AbortError"
      ) {
        return true;
      }
    }
    if (current instanceof Error && current.cause !== undefined) {
      current = current.cause;
      continue;
    }
    break;
  }
  return false;
}
