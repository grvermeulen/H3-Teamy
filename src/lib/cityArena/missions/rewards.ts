import type {
  MissionDefinition,
  MissionReceipt,
  MissionRun,
  MissionWallet,
} from "./types";

/** Cash available for a successful contract, with a replay reduction applied once. */
export function missionPayment(
  definition: MissionDefinition,
  run: MissionRun,
): MissionReceipt {
  const rule = definition.bonus.rule;
  let earnedBonus = false;
  switch (rule.kind) {
    case "time":
      earnedBonus = run.lastTick - run.startedTick <= rule.seconds * 30;
      break;
    case "integrity":
      earnedBonus = run.minimumIntegrity >= rule.minimum;
      break;
    case "noCivilianKills":
      earnedBonus = run.civilianKills === 0;
      break;
    case "undetected":
      earnedBonus = !run.detected;
      break;
    case "optionalItems":
      earnedBonus = rule.items.every((item) => run.inventory.includes(item));
      break;
  }
  const multiplier = run.replay ? 0.5 : 1;
  const base = Math.floor(definition.basePay * multiplier);
  const total = Math.floor(
    (definition.basePay + (earnedBonus ? definition.bonus.amount : 0)) *
      multiplier,
  );
  return {
    contractId: run.contractId,
    missionId: definition.id,
    version: definition.version,
    playerId: run.ownerId,
    tick: run.lastTick,
    base,
    bonus: total - base,
    total,
  };
}

/** Pays only a completed, matching contract and retains its receipt for replay protection. */
export function settleMission(
  wallet: MissionWallet,
  definition: MissionDefinition,
  run: MissionRun,
): MissionWallet {
  if (
    run.status !== "completed" ||
    definition.id !== run.definitionId ||
    definition.version !== run.definitionVersion ||
    wallet.receipts.some((receipt) => receipt.contractId === run.contractId)
  )
    return wallet;
  const receipt = missionPayment(definition, run);
  return {
    balance: wallet.balance + receipt.total,
    earned: wallet.earned + receipt.total,
    receipts: [...wallet.receipts, receipt].slice(-24),
  };
}
