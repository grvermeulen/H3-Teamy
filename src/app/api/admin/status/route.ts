import { NextRequest, NextResponse } from "next/server";
import { getActiveUser } from "../../../../lib/activeUser";
import { prisma } from "../../../../lib/db";

function norm(s: string) {
  return (s || "").toLowerCase().trim();
}

export async function GET(req: NextRequest) {
  const { userId } = await getActiveUser(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const configured = process.env.ADMIN_FULL_NAME || "Guido Vermeulen";
  const full = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  const isAdmin = norm(full) === norm(configured);
  return NextResponse.json({ isAdmin, me: { id: userId, name: full } });
}


