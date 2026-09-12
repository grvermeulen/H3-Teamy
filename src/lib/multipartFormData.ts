/**
 * Controleert of een Content-Type-header multipart/form-data aangeeft.
 *
 * @param contentType - Waarde van de `Content-Type`-header.
 * @returns `true` wanneer de body multipart/form-data is.
 */
export function isMultipartFormDataContentType(
  contentType: string | null | undefined,
): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes("multipart/form-data");
}

/**
 * Herkent de bekende undici/Node-fout bij ongeldige multipart-bodies.
 *
 * @param error - Gevangen fout uit `request.formData()`.
 * @returns `true` wanneer de body niet als FormData geparsed kon worden.
 */
export function isInvalidMultipartBodyError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message === "Failed to parse body as FormData."
  );
}

export type MultipartFormDataResult =
  | { ok: true; form: FormData }
  | {
      ok: false;
      status: 400;
      error: "invalid_content_type" | "invalid_form_data";
      message: string;
    };

/**
 * Leest multipart/form-data veilig uit een request.
 *
 * Geeft een 400-resultaat terug bij ontbrekende of ongeldige multipart-bodies
 * in plaats van een exception te laten escaleren naar Sentry.
 *
 * @param req - Inkomende request met een multipart-body.
 * @returns Geparsed FormData of een clientfoutbeschrijving.
 */
export async function parseMultipartFormData(
  req: Request,
): Promise<MultipartFormDataResult> {
  const contentType = req.headers.get("content-type");
  if (!isMultipartFormDataContentType(contentType)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_content_type",
      message: "Verwacht multipart/form-data met een afbeelding.",
    };
  }

  try {
    const form = await req.formData();
    return { ok: true, form };
  } catch (error: unknown) {
    if (isInvalidMultipartBodyError(error)) {
      return {
        ok: false,
        status: 400,
        error: "invalid_form_data",
        message: "Kon het uploadformulier niet verwerken.",
      };
    }
    throw error;
  }
}
