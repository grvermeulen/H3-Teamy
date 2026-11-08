import type { ReportExtractDiagnosticResponse } from "./reportExtractDiagnostics";

type ApiErrorPayload = {
  error?: string;
  message?: string;
  diagnostic?: ReportExtractDiagnosticResponse;
};

export type ReportExtractClientFailureKind =
  "http" | "network" | "abort" | "non_json";

function supportSuffix(
  diagnostic: ReportExtractDiagnosticResponse | null,
): string {
  if (!diagnostic?.supportRef) return "";
  return ` (referentie: ${diagnostic.supportRef})`;
}

function parseExtractErrorPayload(bodyText: string): ApiErrorPayload | null {
  try {
    return JSON.parse(bodyText) as ApiErrorPayload;
  } catch {
    return null;
  }
}

/**
 * NL-fouttekst voor screenshot-extract (geen ruwe provider- of proxy-body's).
 */
export function formatReportExtractClientError(args: {
  kind: ReportExtractClientFailureKind;
  httpStatus?: number;
  bodyText?: string;
  diagnostic?: ReportExtractDiagnosticResponse | null;
}): string {
  if (args.kind === "abort") {
    const ref = supportSuffix(args.diagnostic ?? null);
    return `De upload is afgebroken. Probeer het opnieuw${ref}.`;
  }

  if (args.kind === "network") {
    const ref = supportSuffix(args.diagnostic ?? null);
    return `Geen verbinding met de server. Controleer je netwerk en probeer het opnieuw${ref}.`;
  }

  if (args.kind === "non_json") {
    const ref = supportSuffix(args.diagnostic ?? null);
    const status = args.httpStatus;
    const proxyHint =
      status === 413
        ? " Het bestand is mogelijk te groot voor de server."
        : status === 502 || status === 504
          ? " De server of gateway reageerde niet met JSON (time-out of proxyfout)."
          : " De server gaf een onverwacht antwoord.";
    return `Screenshot verwerken mislukt.${proxyHint}${ref}`;
  }

  const payload =
    args.bodyText != null ? parseExtractErrorPayload(args.bodyText) : null;
  const diagnostic = payload?.diagnostic ?? args.diagnostic ?? null;
  const ref2 = supportSuffix(diagnostic);
  const code = payload?.error ?? "";
  const errorClass = diagnostic?.errorClass ?? args.diagnostic?.errorClass;

  if (code === "invalid_content_type" || code === "invalid_form_data") {
    return `Kon de upload niet verwerken. Kies opnieuw een afbeelding en probeer het nog eens${ref2}.`;
  }

  if (code === "image_required") {
    return `Geen afbeelding ontvangen. Kies een screenshot en probeer opnieuw${ref2}.`;
  }

  if (code === "extract_provider_config_invalid") {
    return `Screenshot-import is tijdelijk niet beschikbaar (serverconfiguratie). Meld dit bij de beheerder${ref2}.`;
  }

  if (
    code === "openai_failed" ||
    code === "ocr_failed" ||
    code === "provider_failed"
  ) {
    const hint =
      errorClass === "gateway_unauthenticated"
        ? " De AI-koppeling is niet geauthenticeerd."
        : errorClass === "provider_timeout"
          ? " De verwerking duurde te lang."
          : errorClass === "image_dimension_rejected"
            ? " De afbeelding is te groot voor de vision-provider."
            : "";
    return `De screenshot kon niet worden geanalyseerd door de vision-dienst.${hint} Probeer een andere export of later opnieuw${ref2}.`;
  }

  if (errorClass === "preprocess_unreadable") {
    return `De afbeelding kon niet worden ingelezen (bestandsformaat). Probeer een JPEG of PNG-export${ref2}.`;
  }

  if (args.httpStatus === 401 || args.httpStatus === 403) {
    return `Je bent niet gemachtigd om screenshots te importeren${ref2}.`;
  }

  if (payload?.message && payload.message.length <= 200) {
    if (
      !payload.message.includes("Bearer") &&
      !payload.message.includes("sk-")
    ) {
      return `${payload.message}${ref2}`;
    }
  }

  const status = args.httpStatus ?? 0;
  if (status >= 500) {
    return `Screenshot verwerken mislukt door een serverfout. Probeer het later opnieuw${ref2}.`;
  }

  return `Screenshot kon niet worden gelezen. Probeer een scherpere foto of een andere export${ref2}.`;
}

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
