export type SafeRequestContentLength =
  | { present: false }
  | { present: true; value: number };

export type MultipartIngressDiagnostics = {
  contentTypeHasBoundary: boolean;
  contentLength: SafeRequestContentLength;
};

/**
 * Veilige request-metadata bij multipart-uploads (geen headers dump, geen body).
 */
export function readMultipartIngressDiagnostics(
  req: Request,
): MultipartIngressDiagnostics {
  const contentType = req.headers.get("content-type");
  const rawLength = req.headers.get("content-length");
  let contentLength: SafeRequestContentLength = { present: false };
  if (rawLength !== null && rawLength.trim() !== "") {
    const value = Number(rawLength.trim());
    contentLength = Number.isFinite(value)
      ? { present: true, value }
      : { present: false };
  }
  return {
    contentTypeHasBoundary:
      contentType != null && /boundary=/i.test(contentType),
    contentLength,
  };
}
