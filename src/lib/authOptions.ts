import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { isDbUnavailableError } from "./dbUnavailableError";
import {
  isTransientPostgresConnectError,
  withPgConnectRetry,
} from "./prismaConnectRetry";
import { verifyPasskeyExchangeToken } from "./passkeyExchangeToken";
import { USER_CORE_SELECT } from "./userPrismaSelect";

function reportCredentialsAuthorizeError(
  error: unknown,
  context: string,
): void {
  if (isDbUnavailableError(error) || isTransientPostgresConnectError(error)) {
    return;
  }
  const code =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code
      : undefined;
  Sentry.captureException(error, {
    tags: { context },
    extra: { prismaCode: code },
  });
}

/**
 * Normalizes dashboard-managed auth values, which can accidentally include
 * leading or trailing whitespace when pasted into a deployment environment.
 */
export function normalizeAuthEnv(value: string | undefined): string {
  return value?.trim() ?? "";
}

/**
 * NextAuth configuration: Google + credentials, JWT sessions with user id on `session.user.id`.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: normalizeAuthEnv(process.env.GOOGLE_CLIENT_ID),
      clientSecret: normalizeAuthEnv(process.env.GOOGLE_CLIENT_SECRET),
    }),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
        passkeyExchange: { label: "Passkey", type: "text" },
      },
      async authorize(creds) {
        const exchangeRaw = creds?.passkeyExchange;
        const exchange =
          typeof exchangeRaw === "string" ? exchangeRaw.trim() : "";
        if (exchange) {
          const userId = verifyPasskeyExchangeToken(exchange);
          if (!userId) return null;
          try {
            const user = await withPgConnectRetry(
              "credentials_authorize_passkey",
              () =>
                prisma.user.findUnique({
                  where: { id: userId },
                  select: USER_CORE_SELECT,
                }),
            );
            if (!user) return null;
            return {
              id: user.id,
              name: `${user.firstName} ${user.lastName}`.trim(),
              email: user.email ?? undefined,
            };
          } catch (error: unknown) {
            reportCredentialsAuthorizeError(
              error,
              "credentials_authorize_passkey",
            );
            return null;
          }
        }

        const email = String(creds?.email ?? "")
          .trim()
          .toLowerCase();
        const password = (creds?.password as string) || "";
        if (!email || !password) return null;
        try {
          const user = await withPgConnectRetry("credentials_authorize", () =>
            prisma.user.findFirst({
              where: { email },
              select: USER_CORE_SELECT,
            }),
          );
          if (!user || !user.passwordHash) return null;
          const ok = await bcrypt.compare(password, user.passwordHash);
          if (!ok) return null;
          return {
            id: user.id,
            name: `${user.firstName} ${user.lastName}`.trim(),
            email: user.email ?? undefined,
          };
        } catch (error: unknown) {
          reportCredentialsAuthorizeError(error, "credentials_authorize");
          return null;
        }
      },
    }),
  ],
  secret: normalizeAuthEnv(process.env.NEXTAUTH_SECRET) || undefined,
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
      } catch (error: unknown) {
        Sentry.captureException(error, {
          extra: {
            context: "nextauth_redirect_invalid_url",
            url,
            baseUrl,
          },
        });
      }
      return baseUrl;
    },
  },
};
