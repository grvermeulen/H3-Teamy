/** `process.env.NODE_ENV` value that disables the debug overlay outright. */
const PRODUCTION_NODE_ENV = "production";

/** `debug` query-string value that turns the overlay on. */
const DEBUG_ENABLED_VALUE = "1";

/** True when `?debug=1` is in the query string and the build is not a production build. */
export function isDebugEnabled(
  search: string,
  nodeEnv: string | undefined,
): boolean {
  if (nodeEnv === PRODUCTION_NODE_ENV) return false;
  return new URLSearchParams(search).get("debug") === DEBUG_ENABLED_VALUE;
}
