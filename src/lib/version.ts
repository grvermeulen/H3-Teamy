/**
 * Current application version, sourced from `package.json` and inlined at build
 * time via `next.config.js` -> `NEXT_PUBLIC_APP_VERSION`. Used to gate the
 * What's-new tour and to tag submitted feedback so reports include the version
 * the user was on when they wrote them.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
