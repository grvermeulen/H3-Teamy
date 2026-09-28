/**
 * Herkent verwachte client-side pointer-lock-afwijzingen.
 *
 * De arena roept `requestPointerLock` niet aan; deze DOMExceptions komen meestal van
 * browserextensies, embedded webviews of een canvas buiten het actieve document.
 */
export function isBenignPointerLockClientError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "WrongDocumentError") {
    return isPointerLockWrongDocumentMessage(error.message);
  }
  if (error instanceof Error) {
    if (isPointerLockWrongDocumentMessage(error.message)) {
      return true;
    }
    if (error.cause !== undefined) {
      return isBenignPointerLockClientError(error.cause);
    }
  }
  if (typeof error === "string") {
    return isPointerLockWrongDocumentMessage(error);
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return isPointerLockWrongDocumentMessage(
      (error as { message: string }).message,
    );
  }
  return false;
}

function isPointerLockWrongDocumentMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("pointer lock") && lower.includes("not valid");
}
