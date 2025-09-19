import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db";

export async function GET() {
  const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true } }).catch(() => [] as any[]);
  const list = users.map((u: any) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() }));
  return NextResponse.json({ users: list });
}
