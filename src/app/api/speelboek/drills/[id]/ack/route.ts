import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { setDrillAck } from "../../../../../../lib/services/drillEngagementService";
import { findDrill } from "../../../../../../lib/services/speelboekService";
import {
  invalidInput,
  readJson,
  requireLinkedUser,
  serverError,
} from "../../../../../../lib/speelboek/apiGuards";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ acked: z.boolean() });

/** Sets or clears "Ik snap 'm" for the current user. */
export async function PUT(
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
    const parsed = bodySchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error.issues);
    const ackCount = await setDrillAck(
      id,
      guard.value.userId,
      parsed.data.acked,
    );
    return NextResponse.json({ acked: parsed.data.acked, ackCount });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-ack-put");
  }
}
