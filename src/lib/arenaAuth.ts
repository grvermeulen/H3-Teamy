import { getServerSession } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authOptions } from "./authOptions";
import { prisma } from "./db";
import { withPgConnectRetry } from "./prismaConnectRetry";
import {
  ARENA_LIMITS,
  checkRateLimit,
  clientAddress,
  rateLimited,
} from "./rateLimit";

/** A multiplayer identity resolved exclusively from a verified session. */
export type ArenaUser = { userId: string; displayName: string };

/** Enforces pre-auth limits and resolves an existing account without consulting guest cookies. */
export async function authorizeArenaRequest(
  req: NextRequest,
): Promise<ArenaUser | Response> {
  const addressLimit = await checkRateLimit(
    ARENA_LIMITS.preauth,
    clientAddress(req),
  );
  if (!addressLimit.allowed) return rateLimited(addressLimit);
  const globalLimit = await checkRateLimit(ARENA_LIMITS.global, "all");
  if (!globalLimit.allowed) return rateLimited(globalLimit);

  const origin = req.headers.get("origin");
  if (
    req.method !== "GET" &&
    (req.headers.get("sec-fetch-site") === "cross-site" ||
      (origin !== null && origin !== req.nextUrl.origin))
  ) {
    return NextResponse.json(
      { error: "Dit verzoek komt niet van H3" },
      { status: 403 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: "Log in om GTA H3 te spelen" },
      { status: 401 },
    );
  }
  const select = { id: true, firstName: true } as const;
  const user = await withPgConnectRetry("arenaSession", async () => {
    const byId = session.user.id
      ? await prisma.user.findUnique({ where: { id: session.user.id }, select })
      : null;
    if (byId) return byId;
    const email = session.user.email?.trim().toLowerCase();
    return email ? prisma.user.findUnique({ where: { email }, select }) : null;
  });
  if (!user) {
    return NextResponse.json(
      { error: "Koppel eerst je H3-account" },
      { status: 403 },
    );
  }
  return { userId: user.id, displayName: user.firstName?.trim() || "Speler" };
}
