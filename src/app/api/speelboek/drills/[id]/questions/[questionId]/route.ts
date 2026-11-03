import { NextResponse, type NextRequest } from "next/server";
import { resolveDrillQuestion } from "../../../../../../../lib/services/drillEngagementService";
import {
  requireTrainer,
  serverError,
} from "../../../../../../../lib/speelboek/apiGuards";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; questionId: string }> };

/** Marks a player's question as handled (trainer only). */
export async function PATCH(
  req: NextRequest,
  { params }: Ctx,
): Promise<NextResponse> {
  try {
    const guard = await requireTrainer(req);
    if (!guard.ok) return guard.response;
    const { id, questionId } = await params;
    const resolved = await resolveDrillQuestion(id, questionId);
    if (!resolved) {
      return NextResponse.json(
        { error: "Vraag niet gevonden" },
        { status: 404 },
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-question-patch");
  }
}
