type ApiErrorPayload = {
  error?: string;
  message?: string;
};

/**
 * Zet API-fouten voor verslaggeneratie om naar korte Nederlandse meldingen (geen raw JSON in UI).
 */
export function formatReportGenerateError(
  status: number,
  bodyText: string,
): string {
  let payload: ApiErrorPayload | null = null;
  try {
    payload = JSON.parse(bodyText) as ApiErrorPayload;
  } catch {
    payload = null;
  }

  if (payload?.error === "report_input_incomplete") {
    return (
      payload.message ??
      "De screenshot mist een herkenbare eindstand of wedstrijdgebeurtenissen. " +
        "Kies een volledige KNZB/Sportlink-screenshot bij deze wedstrijd."
    );
  }

  if (payload?.error === "invalid_json") {
    return "Ongeldige invoer naar de server. Probeer opnieuw.";
  }

  if (status === 422) {
    return (
      payload?.message ??
      "De wedstrijdgegevens zijn onvolledig. Controleer de screenshot en probeer opnieuw."
    );
  }

  if (status === 401 || status === 403) {
    return "Je bent niet gemachtigd om een verslag te genereren.";
  }

  if (payload?.message) {
    return payload.message;
  }

  if (bodyText.length > 240) {
    return "Verslag genereren mislukt. Probeer het later opnieuw.";
  }

  return bodyText.trim()
    ? `Verslag genereren mislukt: ${bodyText.trim()}`
    : "Verslag genereren mislukt. Probeer het later opnieuw.";
}
