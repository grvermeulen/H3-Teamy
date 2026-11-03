import { NextResponse, type NextRequest } from "next/server";
import { drillQuestionInputSchema } from "../../../../../../lib/schemas/speelboek";
import { askDrillQuestion } from "../../../../../../lib/services/drillEngagementService";
import { findDrill } from "../../../../../../lib/services/speelboekService";
import {
  invalidInput,
  readJson,
  requireLinkedUser,
  serverError,
} from "../../../../../../lib/speelboek/apiGuards";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Stores a question for the trainer about this drill. */
export async function POST(
  req: NextRequest,
  { params }: Ctx,
): Promise<NextResponse> {
  try {
    const guard = await requireLinkedUser(req);
    if (!guard.ok) return guard.response;
    const { id } = await params;
    if (!(await findDrill(id))) {
      return NextResponse.json(
        { error: "Oefening niet gevonden" },
        { status: 404 },
      );
    }
    const parsed = drillQuestionInputSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error.issues);
    const question = await askDrillQuestion(
      id,
      guard.value.userId,
      parsed.data.text,
    );
    return NextResponse.json({ question }, { status: 201 });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-question-post");
  }
}
