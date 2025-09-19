import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { getUserRoles, setUserRoles } from "../../../../lib/kv";
import { isAdminUser } from "../../../../lib/trainer";

function norm(s: string) {
  return (s || "").toLowerCase().trim();
}

function displayName(u: { firstName: string; lastName: string; id: string; email?: string | null }) {
  const full = `${(u.firstName || "").trim()} ${(u.lastName || "").trim()}`.trim();
  if (full) return full;
  const email = (u.email || "").trim();
  if (email) return email;
  return ""; // filter out unknowns
}

export async function GET(req: NextRequest) {
  const { isAdmin } = await isAdminUser(req);
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const adminFull = norm(process.env.ADMIN_FULL_NAME || "");
  const trainerNames = (process.env.TRAINER_FULL_NAMES || "").split(",").map(norm).filter(Boolean);
  const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, email: true }, cacheStrategy: { ttl: 300, swr: 300 } as any });
  const seen = new Set<string>();
  const list = [] as { id: string; name: string; roles: { admin?: boolean; trainer?: boolean; player?: boolean } }[];
  for (const u of users as any[]) {
    const name = displayName(u);
    if (!name) continue;
    const key = norm(name);
    if (seen.has(key)) continue; // dedupe by name
    seen.add(key);
    const kv = await getUserRoles(u.id).catch(() => ({ player: true } as any));
    const full = `${(u.firstName || "").trim()} ${(u.lastName || "").trim()}`.trim();
    const envAdmin = adminFull && norm(full) === adminFull;
    const envTrainer = trainerNames.includes(norm(full));
    const merged = {
      player: kv.player !== false, // default true
      trainer: Boolean(kv.trainer || envTrainer || envAdmin),
      admin: Boolean(kv.admin || envAdmin),
    };
    list.push({ id: u.id, name, roles: merged });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
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


