import { NextRequest } from "next/server";
import { getActiveUser } from "./activeUser";
import { prisma } from "./db";

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
    return { isTrainer: Boolean(isAdmin || isTrainerListed), me: { id: userId, name: full } };
  } catch {
    return { isTrainer: false, me: { id: userId, name: "" } };
  }
}


