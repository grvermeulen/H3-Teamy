import { z } from "zod";
import { missionById } from "./catalog";
import type { MissionReceipt } from "./types";

/** Bounded payout evidence; host authority is still required by the receiving endpoint. */
export const MissionReceiptSchema = z.strictObject({
  contractId: z.string().min(1).max(64),
  missionId: z.string().regex(/^M(?:0[1-9]|1[0-9]|2[0-4])$/),
  version: z.number().int().positive(),
  playerId: z.number().int().nonnegative(),
  tick: z.number().int().min(0).max(2_147_483_647),
  base: z.number().int().min(0).max(10_000),
  bonus: z.number().int().min(0).max(10_000),
  total: z.number().int().min(0).max(20_000),
});

/** Checks once-per-round rewards against the catalogue and the available round duration. */
export function validRoundReceipts(
  receipts: MissionReceipt[],
  zone: string,
  seconds: number,
): boolean {
  const contracts = new Set<string>();
  const missions = new Set<string>();
  let minimumSeconds = 0;
  for (const receipt of receipts) {
    const mission = missionById(receipt.missionId);
    if (
      !mission ||
      mission.zone !== zone ||
      mission.version !== receipt.version ||
      contracts.has(receipt.contractId) ||
      missions.has(receipt.missionId) ||
      receipt.base !== mission.basePay ||
      (receipt.bonus !== 0 && receipt.bonus !== mission.bonus.amount) ||
      receipt.total !== receipt.base + receipt.bonus
    )
      return false;
    contracts.add(receipt.contractId);
    missions.add(receipt.missionId);
    // Every stage needs a separate simulation tick; explicit holds cannot be skipped.
    minimumSeconds += mission.stages.reduce(
      (sum, stage) => sum + minimumObjectiveSeconds(stage.objective),
      0,
    );
  }
  return minimumSeconds <= seconds;
}

function minimumObjectiveSeconds(
  objective: import("./types").MissionObjective,
): number {
  if (objective.kind === "composite") {
    const times = objective.objectives.map(minimumObjectiveSeconds);
    return Math.max(...times);
  }
  if ("seconds" in objective) return objective.seconds;
  return 1 / 30;
}
