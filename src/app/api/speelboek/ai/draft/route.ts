import { NextResponse, type NextRequest } from "next/server";
import { draftDrill } from "../../../../../lib/ai/speelboekDraft";
import {
  checkRateLimit,
  rateLimited,
  type RateLimitRule,
} from "../../../../../lib/rateLimit";
import { drillDraftRequestSchema } from "../../../../../lib/schemas/speelboek";
import {
  invalidInput,
  readJson,
  requireTrainer,
  serverError,
} from "../../../../../lib/speelboek/apiGuards";

export const dynamic = "force-dynamic";
/** Vision calls on a whiteboard photo can take a while. */
export const maxDuration = 60;

/** Per trainer: a handful of drafts per minute is plenty and bounds AI spend. */
const DRAFT_LIMIT: RateLimitRule = {
  name: "speelboek-ai-draft",
  limit: 6,
  windowSec: 60,
};

/** Drafts a drill from a description and/or whiteboard photo (trainer only). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const guard = await requireTrainer(req);
    if (!guard.ok) return guard.response;
    const verdict = await checkRateLimit(DRAFT_LIMIT, guard.value.id);
    if (!verdict.allowed) return rateLimited(verdict);
    const parsed = drillDraftRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error.issues);
    const result = await draftDrill(parsed.data);
    return NextResponse.json(result);
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-ai-draft");
  }
}
