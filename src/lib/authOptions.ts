import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import bcrypt from "bcryptjs";

/**
 * NextAuth configuration: Google + credentials, JWT sessions with user id on `session.user.id`.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        const email = (creds?.email as string) || "";
        const password = (creds?.password as string) || "";
        if (!email || !password) return null;
        try {
          const user = await prisma.user.findFirst({ where: { email } });
          if (!user || !user.passwordHash) return null;
          const ok = await bcrypt.compare(password, user.passwordHash);
          if (!ok) return null;
          return {
            id: user.id,
            name: `${user.firstName} ${user.lastName}`.trim(),
            email: user.email ?? undefined,
          };
        } catch (error: unknown) {
          const code =
            error instanceof Prisma.PrismaClientKnownRequestError
              ? error.code
              : undefined;
          Sentry.captureException(error, {
            tags: { context: "credentials_authorize" },
            extra: { prismaCode: code },
          });
          return null;
        }
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`;
      }
      try {
        const u = new URL(url);
        if (u.origin === baseUrl) return url;
      } catch {
        // Invalid url — fall through to baseUrl
      }
      return baseUrl;
    },
  },
};
