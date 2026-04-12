/**
 * Side-effect: sets `process.env.NEXTAUTH_URL` before NextAuth reads it (preview + Vercel fallbacks).
 */
import { resolveNextAuthUrl } from "./nextAuthUrl";

const resolved = resolveNextAuthUrl();
if (resolved) {
  process.env.NEXTAUTH_URL = resolved;
}
