import { ATTEMPT_ID_PATTERN } from "./reportExtractAttemptIdPattern";

/**
 * Maakt een client-side correlatie-id voor een screenshot-extractpoging.
 */
export function createReportExtractAttemptId(): string {
  return crypto.randomUUID();
}

/**
 * Valideert een client meegegeven poging-id; genereert een nieuwe wanneer ongeldig.
 *
 * @param headerValue - Waarde van `X-Report-Extract-Attempt`.
 */
export function resolveReportExtractAttemptId(
  headerValue: string | null | undefined,
  formValue?: string | null,
): string {
  const trimmed = headerValue?.trim();
  if (trimmed && ATTEMPT_ID_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const fromForm = formValue?.trim();
  if (fromForm && ATTEMPT_ID_PATTERN.test(fromForm)) {
    return fromForm.toLowerCase();
  }
  return crypto.randomUUID();
}

/**
 * Korte ondersteuningsreferentie (geen volledige UUID in UI).
 */
export function reportExtractSupportRef(
  attemptId: string,
  requestId: string,
): string {
  const a = attemptId.replace(/-/g, "").slice(0, 8);
  const r = requestId.replace(/-/g, "").slice(0, 8);
  return `${a}-${r}`;
}
