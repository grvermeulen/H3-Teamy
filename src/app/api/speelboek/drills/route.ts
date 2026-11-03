import { NextResponse, type NextRequest } from "next/server";
import { drillInputSchema } from "../../../../lib/schemas/speelboek";
import { getAllDrills } from "../../../../lib/services/speelboekService";
import { createStoredDrill } from "../../../../lib/services/speelboekStore";
import {
  invalidInput,
  readJson,
  requireTrainer,
  serverError,
} from "../../../../lib/speelboek/apiGuards";
import { isTrainer } from "../../../../lib/trainer";

export const dynamic = "force-dynamic";

/** Lists drills; trainers also get unpublished drafts. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { isTrainer: trainer } = await isTrainer(req);
    const drills = await getAllDrills(trainer);
    return NextResponse.json({ drills });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-drills-get");
  }
}

/** Creates a trainer drill. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const guard = await requireTrainer(req);
    if (!guard.ok) return guard.response;
    const parsed = drillInputSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error.issues);
    const drill = await createStoredDrill(parsed.data, guard.value.id);
    return NextResponse.json({ drill }, { status: 201 });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-drills-post");
  }
}
