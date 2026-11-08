/**
 * Bepaalt of een extract-route `Sentry.captureException` moet aanroepen.
 * Operationele providerfouten (502 gateway/VLM) horen alleen in trace-logs.
 *
 * @param code - {@link ExtractProviderError.code} of gerelateerde foutcode.
 * @param errorClass - Geclassificeerde fout uit {@link classifyExtractProviderFailure}.
 */
export function shouldCaptureReportExtractProviderForSentry(
  code: string,
  errorClass: string,
): boolean {
  if (code === "extract_provider_config_invalid") return true;
  if (errorClass === "unexpected") return true;
  return false;
}
