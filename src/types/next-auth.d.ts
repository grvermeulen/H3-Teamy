import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  /**
   * Session shape including stable user id for app identity resolution.
   */
  interface Session {
    user: {
      /** Prisma user id, from JWT `sub` after sign-in. */
      id?: string;
    } & DefaultSession["user"];
  }
}
