import { NextResponse, type NextRequest } from "next/server";
import { getActiveUser } from "../../../../lib/activeUser";
import { listAckedDrillIds } from "../../../../lib/services/drillEngagementService";
import { serverError } from "../../../../lib/speelboek/apiGuards";

export const dynamic = "force-dynamic";

/** Drill ids the current user has ticked off ("Ik snap 'm"). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, needsLink } = await getActiveUser(req);
    const drillIds = needsLink ? [] : await listAckedDrillIds(userId);
    return NextResponse.json({ drillIds });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-acks-get");
  }
}
