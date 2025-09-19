import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { getUserRoles, setUserRoles } from "../../../../lib/kv";
import { isAdminUser } from "../../../../lib/trainer";

export async function GET(req: NextRequest) {
  const { isAdmin } = await isAdminUser(req);
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, email: true } });
  const list = await Promise.all(users.map(async (u) => {
    const roles = await getUserRoles(u.id).catch(() => ({ player: true }));
    return { id: u.id, name: `${u.firstName} ${u.lastName}`.trim() || (u.email || `User ${u.id.slice(0,6)}`), roles };
  }));
  return NextResponse.json({ users: list });
}

export async function PUT(req: NextRequest) {
  const { isAdmin } = await isAdminUser(req);
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({} as any));
  const items = Array.isArray(body?.items) ? body.items as { id: string; roles: { admin?: boolean; trainer?: boolean; player?: boolean } }[] : [];
  for (const it of items) {
    const roles = {
      admin: Boolean(it.roles?.admin),
      trainer: Boolean(it.roles?.trainer),
      player: it.roles?.player === false ? false : true,
    };
    await setUserRoles(it.id, roles);
  }
  return NextResponse.json({ ok: true });
}


