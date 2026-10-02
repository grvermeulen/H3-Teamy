/**
 * Side-effect: sets `process.env.NEXTAUTH_URL` before NextAuth reads it (preview + Vercel fallbacks).
 */
import { applyNextAuthUrlEnv } from "./nextAuthUrl";

applyNextAuthUrlEnv();
