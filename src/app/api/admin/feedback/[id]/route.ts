import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import { isAdminUser } from "../../../../../lib/trainer";
import { FeedbackStatusUpdateBodySchema } from "../../../../../lib/schemas/feedback";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { isAdmin } = await isAdminUser(req);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = FeedbackStatusUpdateBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const updated = await prisma.feedback.update({
      where: { id },
      data: { status: parsed.data.status },
      select: { id: true, status: true },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
