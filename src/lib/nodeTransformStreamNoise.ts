/**
 * Detecteert de interne Node.js `TransformStream`-race die optreedt wanneer een
 * RSC-stream wordt afgebroken terwijl chunks nog in de transform-queue zitten.
 * Next.js vangt de throw; zonder filter levert dit Sentry-ruis op (o.a.
 * JAVASCRIPT-NEXTJS-3D). Opgelost in Node ≥ 24.15.0 (node#62040).
 *
 * @param error - Fout uit `onRequestError` of een `catch`.
 * @returns `true` wanneer de melding overeenkomt met bekende webstreams-ruis.
 */
export function isNodeTransformStreamRaceNoise(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name !== "TypeError") return false;

  const message = error.message.toLowerCase();
  if (!message.includes("transformalgorithm is not a function")) {
    return false;
  }

  const stack = error.stack ?? "";
  return stack.includes("node:internal/webstreams/transformstream");
}
