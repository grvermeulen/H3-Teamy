import { NextResponse, type NextRequest } from "next/server";
import { trainingDateSchema } from "../../../../../../lib/schemas/speelboek";
import { shareProgram } from "../../../../../../lib/services/trainingProgramService";
import {
  invalidInput,
  requireTrainer,
  serverError,
} from "../../../../../../lib/speelboek/apiGuards";
import { describeRelativeDay } from "../../../../../../lib/training";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ date: string }> };

/** Sends the programme for a date to the team WhatsApp group (trainer only). */
export async function POST(
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
    const dayLabel = describeRelativeDay(new Date(`${date}T12:00:00`));
    const result = await shareProgram(date, dayLabel);
    if (result.sent) return NextResponse.json(result);
    const configProblem =
      result.reason === "disabled" || result.reason === "missing_config";
    return NextResponse.json(result, { status: configProblem ? 409 : 502 });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-program-share");
  }
}
