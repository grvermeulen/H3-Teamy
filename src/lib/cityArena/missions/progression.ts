import { z } from "zod";
import { MissionProfileSchema } from "./validation";
import type {
  MissionDefinition,
  MissionProfile,
  MissionReceipt,
  MissionRun,
} from "./types";

/** Local story progress never serves as evidence for a multiplayer result. */
export const MISSION_SAVE_KEY = "h3-arena-story-v1";
const saveSchema = z.strictObject({
  version: z.literal(1),
  tick: z.number().int().min(0).max(2_147_483_647),
  savedAt: z.number().finite().nonnegative(),
  profile: MissionProfileSchema,
});

/** Records a best medal and best completion time without changing the payout. */
export function missionRecords(
  profile: MissionProfile,
  definition: MissionDefinition,
  run: MissionRun,
  receipt: MissionReceipt,
): NonNullable<MissionProfile["records"]> {
  const seconds = (run.lastTick - run.startedTick) / 30;
  const medal =
    receipt.bonus > 0
      ? seconds <= definition.estimatedSeconds && run.minimumIntegrity >= 75
        ? "gold"
        : "silver"
      : "bronze";
  const old = profile.records?.[definition.id];
  const rank = { bronze: 0, silver: 1, gold: 2 };
  return {
    ...profile.records,
    [definition.id]: {
      medal: old && rank[old.medal] > rank[medal] ? old.medal : medal,
      seconds: Math.min(old?.seconds ?? Infinity, seconds),
    },
  };
}

/** Atomically writes unlocks, wallet, receipts and checkpoint; quota/private mode may disable saving. */
export function saveMissionProgress(
  profile: MissionProfile,
  tick: number,
  now = Date.now(),
): void {
  try {
    localStorage.setItem(
      MISSION_SAVE_KEY,
      JSON.stringify({
        version: 1,
        tick,
        savedAt: now,
        profile: {
          ...profile,
          offer: null,
          actors: {},
          appliedStage: undefined,
        },
      }),
    );
  } catch {
    /* Local storage is optional. */
  }
}

/** Restores local progression and offers an interrupted job's checkpoint as an explicit retry. */
export function loadMissionProgress(
  now = Date.now(),
): { profile: MissionProfile; tick: number } | null {
  try {
    const raw = localStorage.getItem(MISSION_SAVE_KEY);
    if (!raw || raw.length > 64 * 1024) return null;
    const parsed = saveSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const { profile, tick, savedAt } = parsed.data;
    const elapsed = Math.max(0, Math.floor(((now - savedAt) * 30) / 1000));
    return {
      tick,
      profile: {
        ...profile,
        actors: {},
        offer: null,
        appliedStage: undefined,
        cooldownUntil: Object.fromEntries(
          Object.entries(profile.cooldownUntil).map(([id, until]) => [
            id,
            Math.max(tick, until - elapsed),
          ]),
        ),
        run:
          profile.run?.status === "active"
            ? {
                ...profile.run,
                status: "failed",
                failure:
                  "Sessie hervat. Kies opnieuw proberen om je controlepunt te laden.",
              }
            : profile.run,
      },
    };
  } catch {
    return null;
  }
}
