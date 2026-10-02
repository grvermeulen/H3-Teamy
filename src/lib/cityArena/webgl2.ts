/**
 * The one failure of the 3D view that is not a bug: a device without WebGL2. The renderer throws
 * {@link WebGl2UnavailableError}; the view switch recognises it with {@link isWebGl2Unavailable}
 * and falls back to 2D without reporting an error (AGENTS.md: expected client failures are not
 * Sentry issues). Kept free of three.js so the 2D bundle can import it.
 */

/** The `name` of {@link WebGl2UnavailableError}, which survives chunk boundaries unlike `instanceof`. */
const WEBGL2_UNAVAILABLE = "WebGl2UnavailableError";

/** Thrown when a canvas offers no WebGL2 context. */
export class WebGl2UnavailableError extends Error {
  /** Creates the error with a fixed message. */
  constructor() {
    super("WebGL2 is not available on this device");
    this.name = WEBGL2_UNAVAILABLE;
  }
}

/**
 * True when `error` says the device has no WebGL2.
 *
 * @param error - Anything caught.
 * @returns Whether it is a {@link WebGl2UnavailableError}.
 */
export function isWebGl2Unavailable(error: unknown): boolean {
  return error instanceof Error && error.name === WEBGL2_UNAVAILABLE;
}

/**
 * Whether this browser can make a WebGL2 context, asked of a throwaway canvas before the 3D view's
 * chunk is downloaded — a device without WebGL2 then never fetches three.js at all. The probe's
 * context is lost straight away, so it does not count against the browser's live-context limit.
 *
 * @param doc - The document to make the probe canvas in.
 * @returns True when a WebGL2 context was available.
 */
export function hasWebGl2(doc: Document = document): boolean {
  const context = doc.createElement("canvas").getContext("webgl2");
  if (!context) return false;
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}
