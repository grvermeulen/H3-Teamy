import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "../../../../lib/db";
import { getUserRolesBatch, setUserRoles, kvDelete } from "../../../../lib/kv";
import { isAdminUser } from "../../../../lib/trainer";
import { displayName, hasUserIdentity } from "../../../../lib/userUtils";
import { withDbRequestMetrics } from "../../../../lib/dbMetrics";

function norm(s: string) {
  return (s || "").toLowerCase().trim();
}

export async function GET(req: NextRequest) {
  return withDbRequestMetrics("api/admin/users.GET", async () => {
    const { isAdmin } = await isAdminUser(req);
    if (!isAdmin)
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const adminFull = norm(process.env.ADMIN_FULL_NAME || "");
    const trainerNames = (process.env.TRAINER_FULL_NAMES || "")
      .split(",")
      .map(norm)
      .filter(Boolean);
    let users: {
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
    }[] = [];
    try {
      users = await prisma.user.findMany({
        select: { id: true, firstName: true, lastName: true, email: true },
      });
    } catch (e: unknown) {
      Sentry.captureException(e);
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: "users_query_failed", message },
        { status: 500 },
      );
    }
    const list = [] as {
      id: string;
      name: string;
      roles: { admin?: boolean; trainer?: boolean; player?: boolean };
    }[];
    const rolesByUserId: Record<
      string,
      { admin?: boolean; trainer?: boolean; player?: boolean }
    > = await getUserRolesBatch(users.map((u) => u.id)).catch(
      (error: unknown) => {
        Sentry.captureException(error);
        return {};
      },
    );
    for (const u of users) {
      if (!hasUserIdentity(u)) continue;
      const name = displayName(u);
      if (!name) continue;
      const kv = rolesByUserId[u.id] || { player: true };
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
  });
}

export async function PUT(req: NextRequest) {
  return withDbRequestMetrics("api/admin/users.PUT", async () => {
    const { isAdmin } = await isAdminUser(req);
    if (!isAdmin)
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    let body: unknown;
    try {
      body = await req.json();
    } catch (error: unknown) {
      Sentry.captureException(error, {
        extra: { context: "admin/users PUT json parse" },
      });
      return NextResponse.json(
        { error: "invalid_json", message: "Invalid JSON payload." },
        { status: 400 },
      );
    }
    const parsed =
      typeof body === "object" && body !== null
        ? (body as { items?: unknown })
        : {};
    const items = Array.isArray(parsed.items)
      ? (parsed.items as {
          id: string;
          roles: { admin?: boolean; trainer?: boolean; player?: boolean };
        }[])
      : [];
    for (const it of items) {
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
  });
}
