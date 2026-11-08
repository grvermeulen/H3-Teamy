/** Ruimte onder Vercel serverless body-limiet (~4,5 MiB). */
export const REPORT_SCREENSHOT_MAX_BYTES = 4_500_000;

const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export type MaterializeScreenshotErrorClass =
  | "empty_file"
  | "read_failed"
  | "too_large"
  | "unsupported_type"
  | "read_aborted";

export type MaterializeScreenshotResult =
  | {
      ok: true;
      file: File;
      bytes: number;
      mimeType: string;
    }
  | {
      ok: false;
      errorClass: MaterializeScreenshotErrorClass;
    };

function normalizeMime(type: string): string {
  return type.trim().toLowerCase().split(";")[0] ?? "";
}

function mimeToExtension(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
    case "image/heif":
      return "heic";
    default:
      return "jpg";
  }
}

function isAllowedImageMime(mime: string): boolean {
  if (ALLOWED_IMAGE_MIME.has(mime)) return true;
  return mime.startsWith("image/");
}

/**
 * Leest een kiosk/gallery-`File` direct in geheugen zodat upload niet afhangt
 * van een vervallen OS-referentie (o.a. iOS WebKit). Geen originele bestandsnaam.
 */
export async function materializeScreenshotUploadFile(
  source: File,
  options?: { signal?: AbortSignal },
): Promise<MaterializeScreenshotResult> {
  const mimeType = normalizeMime(source.type || "image/jpeg");
  if (!isAllowedImageMime(mimeType)) {
    return { ok: false, errorClass: "unsupported_type" };
  }

  const declaredSize = source.size;
  if (declaredSize <= 0) {
    return { ok: false, errorClass: "empty_file" };
  }
  if (declaredSize > REPORT_SCREENSHOT_MAX_BYTES) {
    return { ok: false, errorClass: "too_large" };
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await source.arrayBuffer();
    if (options?.signal?.aborted) {
      return { ok: false, errorClass: "read_aborted" };
    }
  } catch {
    if (options?.signal?.aborted) {
      return { ok: false, errorClass: "read_aborted" };
    }
    return { ok: false, errorClass: "read_failed" };
  }

  const bytes = buffer.byteLength;
  if (bytes <= 0) {
    return { ok: false, errorClass: "empty_file" };
  }
  if (bytes > REPORT_SCREENSHOT_MAX_BYTES) {
    return { ok: false, errorClass: "too_large" };
  }

  const ext = mimeToExtension(mimeType);
  const file = new File([buffer], `screenshot-upload.${ext}`, {
    type: mimeType || "image/jpeg",
    lastModified: Date.now(),
  });

  return { ok: true, file, bytes, mimeType: file.type };
}

/**
 * NL-melding bij materialisatiefout (geen bestandsnaam of ruwe fouttekst).
 */
export function formatMaterializeScreenshotError(
  errorClass: MaterializeScreenshotErrorClass,
): string {
  switch (errorClass) {
    case "empty_file":
      return "De gekozen afbeelding is leeg. Kies de screenshot opnieuw.";
    case "too_large":
      return "De afbeelding is te groot om te uploaden (max. ca. 4,5 MB).";
    case "unsupported_type":
      return "Dit bestandstype wordt niet ondersteund. Kies een JPEG- of PNG-screenshot.";
    case "read_aborted":
      return "Het laden van de afbeelding is afgebroken. Kies het bestand opnieuw.";
    case "read_failed":
    default:
      return "De afbeelding kon niet worden ingelezen. Probeer het bestand opnieuw te kiezen.";
  }
}
