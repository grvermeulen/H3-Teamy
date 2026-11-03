import { NextResponse, type NextRequest } from "next/server";
import {
  programInputSchema,
  trainingDateSchema,
} from "../../../../../lib/schemas/speelboek";
import { ackCountsByDrill } from "../../../../../lib/services/drillEngagementService";
import {
  getProgram,
  setProgram,
} from "../../../../../lib/services/trainingProgramService";
import {
  invalidInput,
  readJson,
  requireTrainer,
  serverError,
} from "../../../../../lib/speelboek/apiGuards";
import { isTrainer } from "../../../../../lib/trainer";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ date: string }> };

/** Programme for a training date; trainers also get ack counts per drill. */
export async function GET(
  req: NextRequest,
  { params }: Ctx,
): Promise<NextResponse> {
  try {
    const { date } = await params;
    if (!trainingDateSchema.safeParse(date).success) {
      return invalidInput([{ path: ["date"], message: "Ongeldige datum" }]);
    }
    const { isTrainer: trainer } = await isTrainer(req);
    const program = await getProgram(date, trainer);
    const ackCounts = trainer
      ? await ackCountsByDrill(program.items.map((i) => i.drillId))
      : undefined;
    return NextResponse.json({ ...program, ackCounts });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-program-get");
  }
}

/** Replaces the programme for a training date (trainer only). */
export async function PUT(
  req: NextRequest,
  { params }: Ctx,
): Promise<NextResponse> {
  try {
    const guard = await requireTrainer(req);
    if (!guard.ok) return guard.response;
    const { date } = await params;
    if (!trainingDateSchema.safeParse(date).success) {
      return invalidInput([{ path: ["date"], message: "Ongeldige datum" }]);
    }
    const parsed = programInputSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error.issues);
    const program = await setProgram(date, parsed.data.items);
    if (!program) {
      return invalidInput([
        { path: ["items"], message: "Onbekende of dubbele oefening" },
      ]);
    }
    return NextResponse.json(program);
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-program-put");
  }
}
