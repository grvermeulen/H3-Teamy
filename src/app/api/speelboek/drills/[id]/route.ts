import { NextResponse, type NextRequest } from "next/server";
import { drillInputSchema } from "../../../../../lib/schemas/speelboek";
import {
  findDrill,
  isStaticDrill,
} from "../../../../../lib/services/speelboekService";
import {
  deleteStoredDrill,
  updateStoredDrill,
} from "../../../../../lib/services/speelboekStore";
import {
  invalidInput,
  readJson,
  requireTrainer,
  serverError,
} from "../../../../../lib/speelboek/apiGuards";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = (): NextResponse =>
  NextResponse.json({ error: "Oefening niet gevonden" }, { status: 404 });

const staticReadOnly = (): NextResponse =>
  NextResponse.json(
    { error: "Oefeningen uit de vaste bibliotheek kun je niet bewerken" },
    { status: 409 },
  );

/** Returns one drill (unpublished trainer drafts are unlisted but fetchable). */
export async function GET(
  _req: NextRequest,
  { params }: Ctx,
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const drill = await findDrill(id);
    if (!drill) return notFound();
    return NextResponse.json({ drill });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-drill-get");
  }
}

/** Replaces a trainer drill. */
export async function PUT(
  req: NextRequest,
  { params }: Ctx,
): Promise<NextResponse> {
  try {
    const guard = await requireTrainer(req);
    if (!guard.ok) return guard.response;
    const { id } = await params;
    if (isStaticDrill(id)) return staticReadOnly();
    const parsed = drillInputSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error.issues);
    const drill = await updateStoredDrill(id, parsed.data);
    if (!drill) return notFound();
    return NextResponse.json({ drill });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-drill-put");
  }
}

/** Deletes a trainer drill. */
export async function DELETE(
  req: NextRequest,
  { params }: Ctx,
): Promise<NextResponse> {
  try {
    const guard = await requireTrainer(req);
    if (!guard.ok) return guard.response;
    const { id } = await params;
    if (isStaticDrill(id)) return staticReadOnly();
    const deleted = await deleteStoredDrill(id);
    if (!deleted) return notFound();
    return new NextResponse(null, { status: 204 });
  } catch (err: unknown) {
    return serverError(err, "api-speelboek-drill-delete");
  }
}
