import { NextResponse } from "next/server";
import { getUpcomingProgram } from "../../../../../lib/services/trainingProgramService";
import { serverError } from "../../../../../lib/speelboek/apiGuards";

export const dynamic = "force-dynamic";

/** The next training programme players should prepare for, or `null`. */
export async function GET(): Promise<NextResponse> {
  try {
    const program = await getUpcomingProgram();
    return NextResponse.json({ program });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-program-upcoming");
  }
}
