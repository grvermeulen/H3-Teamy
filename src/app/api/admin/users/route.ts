import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { prisma } from "../../../../lib/db";
import { getUserRoles, setUserRoles, kvDelete } from "../../../../lib/kv";
import { isAdminUser } from "../../../../lib/trainer";
import { displayName, hasUserIdentity } from "../../../../lib/userUtils";

type RoleFlags = { admin?: boolean; trainer?: boolean; player?: boolean };

const UserRolesUpdateSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      roles: z
        .object({
          admin: z.boolean().optional(),
          trainer: z.boolean().optional(),
          player: z.boolean().optional(),
        })
        .optional(),
    }),
  ),
});

function norm(s: string): string {
  return (s || "").toLowerCase().trim();
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { isAdmin } = await isAdminUser(req);
  if (!isAdmin)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const adminFull = norm(process.env.ADMIN_FULL_NAME || "");
  const trainerNames = (process.env.TRAINER_FULL_NAMES || "")
    .split(",")
    .map(norm)
    .filter(Boolean);
  let users: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
  }> = [];
  try {
    users = await prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  } catch (e: unknown) {
    const eventId = Sentry.captureException(e, {
      extra: { context: "admin_users_get_query" },
    });
    return NextResponse.json(
      {
        error: "users_query_failed",
        message: "Er is een fout opgetreden bij het ophalen van gebruikers.",
        eventId,
      },
      { status: 500 },
    );
  }
  const list: {
    id: string;
    name: string;
    roles: RoleFlags;
  }[] = [];
  for (const u of users) {
    if (!hasUserIdentity(u)) continue;
    const name = displayName(u);
    if (!name) continue;
    let kv: RoleFlags = { player: true };
    try {
      kv = await getUserRoles(u.id);
    } catch (error: unknown) {
      Sentry.captureException(error, {
        extra: { context: "admin_users_get_roles", userId: u.id },
      });
    }
    const full =
      `${(u.firstName || "").trim()} ${(u.lastName || "").trim()}`.trim();
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

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { isAdmin } = await isAdminUser(req);
  if (!isAdmin)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: unknown;
  try {
    body = await req.json();
  } catch (error: unknown) {
    return NextResponse.json(
      { error: "invalid_json", message: "Ongeldige JSON-invoer." },
      { status: 400 },
    );
  }
  const parsed = UserRolesUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", message: "Ongeldige invoer voor rollen." },
      { status: 400 },
    );
  }
  for (const it of parsed.data.items) {
    const roles = {
      admin: Boolean(it.roles?.admin),
      trainer: Boolean(it.roles?.trainer),
      player: it.roles?.player === false ? false : true,
    };
    await setUserRoles(it.id, roles);
  }
  // Invalidate roster cache so admin list updates reflect immediately
  await kvDelete("users:roster:v2");
  return NextResponse.json({ ok: true });
}
