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
