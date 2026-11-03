import { NextResponse, type NextRequest } from "next/server";
import { getActiveUser } from "../../../../../../lib/activeUser";
import { getDrillEngagement } from "../../../../../../lib/services/drillEngagementService";
import { serverError } from "../../../../../../lib/speelboek/apiGuards";
import { isTrainer } from "../../../../../../lib/trainer";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Ack count, the viewer's ack and questions (all open ones for trainers, own ones otherwise). */
export async function GET(
  req: NextRequest,
  { params }: Ctx,
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const [{ userId, needsLink }, { isTrainer: trainer }] = await Promise.all([
      getActiveUser(req),
      isTrainer(req),
    ]);
    const engagement = await getDrillEngagement(
      id,
      needsLink ? null : userId,
      trainer,
    );
    return NextResponse.json({ ...engagement, isTrainer: trainer });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-engagement-get");
  }
}
