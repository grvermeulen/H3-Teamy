import { NextRequest } from "next/server";
import { getActiveUser } from "./activeUser";
import { prisma } from "./db";
import { getUserRoles } from "./kv";

function norm(s: string) {
  return (s || "").toLowerCase().trim();
}

export async function isTrainer(req: NextRequest): Promise<{ isTrainer: boolean; me: { id: string; name: string } } > {
  const { userId } = await getActiveUser(req);
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const full = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
    const admin = process.env.ADMIN_FULL_NAME || "";
    const trainers = (process.env.TRAINER_FULL_NAMES || "").split(",").map((s) => norm(s)).filter(Boolean);
    const isAdmin = norm(full) === norm(admin);
    const isTrainerListed = trainers.includes(norm(full));
    const roles = await getUserRoles(userId).catch(() => ({ player: true } as any));
    const byRole = Boolean(roles?.trainer || roles?.admin);
    return { isTrainer: Boolean(isAdmin || isTrainerListed || byRole), me: { id: userId, name: full } };
  } catch {
    return { isTrainer: false, me: { id: userId, name: "" } };
  }
}

export async function isAdminUser(req: NextRequest): Promise<{ isAdmin: boolean; me: { id: string; name: string } } > {
  const { userId } = await getActiveUser(req);
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const full = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
    const admin = process.env.ADMIN_FULL_NAME || "";
    const envAdmin = norm(full) === norm(admin);
    const roles = await getUserRoles(userId).catch(() => ({ player: true } as any));
    const byRole = Boolean(roles?.admin);
    return { isAdmin: Boolean(envAdmin || byRole), me: { id: userId, name: full } };
  } catch {
    return { isAdmin: false, me: { id: userId, name: "" } };
  }
}


