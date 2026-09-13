import { NextResponse, type NextRequest } from "next/server";
import {
  arenaDisplayError,
  authorizeArenaDisplayRequest,
} from "@/lib/arenaDisplayApi";
import { ARENA_LIMITS, checkRateLimit, rateLimited } from "@/lib/rateLimit";
import { PostMatchSchema } from "@/lib/schemas/arena";
import { recordMatch } from "@/lib/services/arenaMatchService";

/** A screen may record only a round for which it holds the current host lease. */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const identity = await authorizeArenaDisplayRequest(req);
    if (identity instanceof Response) return identity;
    const limit = await checkRateLimit(
      ARENA_LIMITS.matches,
      identity.displayKeyHash,
    );
    if (!limit.allowed) return rateLimited(limit);
    const parsed = PostMatchSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Ongeldige uitslag" }, { status: 400 });
    return NextResponse.json(await recordMatch(identity, parsed.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    return arenaDisplayError(error);
  }
}
