import { emptyObjectiveProgress, stepObjective } from "./objectives";
import type {
  MissionDefinition,
  MissionObservation,
  MissionRun,
} from "./types";

/** Starts an accepted contract after the caller has checked its contact and unlock rules. */
export function startMission(
  definition: MissionDefinition,
  ownerId: number,
  contractId: string,
  tick: number,
  replay = false,
): MissionRun {
  return {
    contractId,
    definitionId: definition.id,
    definitionVersion: definition.version,
    ownerId,
    status: "active",
    stage: 0,
    startedTick: tick,
    stageTick: tick,
    lastTick: tick,
    progressTick: tick,
    hint: 0,
    objective: emptyObjectiveProgress(),
    inventory: [],
    detected: false,
    civilianKills: 0,
    minimumIntegrity: 100,
    replay,
    checkpoint: null,
    failure: null,
  };
}

/** Advances one stage at most, with destruction/death taking precedence over completion. */
export function stepMission(
  definition: MissionDefinition,
  run: MissionRun,
  observation: MissionObservation,
): MissionRun {
  if (
    run.status !== "active" ||
    observation.playerId !== run.ownerId ||
    observation.tick <= run.lastTick
  )
    return run;
  if (
    definition.id !== run.definitionId ||
    definition.version !== run.definitionVersion
  )
    return {
      ...run,
      status: "failed",
      failure: "Deze missie is bijgewerkt. Start haar opnieuw.",
    };
  const stage = definition.stages[run.stage];
  const failure = !observation.alive
    ? "Je bent uitgeschakeld."
    : observation.essentialFailure;
  if (failure)
    return { ...run, status: "failed", failure, lastTick: observation.tick };
  const result = stepObjective(
    stage.objective,
    run.objective,
    observation,
    run.inventory,
  );
  const progressTick = result.advanced ? observation.tick : run.progressTick;
  const next: MissionRun = {
    ...run,
    lastTick: observation.tick,
    progressTick,
    objective: result.progress,
    inventory: [
      ...new Set([
        ...run.inventory.filter((item) => !result.consumed.includes(item)),
        ...result.collected,
      ]),
    ],
    civilianKills: run.civilianKills + observation.civilianKills,
    minimumIntegrity:
      definition.bonus.rule.kind === "integrity" &&
      definition.bonus.rule.atCompletion
        ? observation.minimumIntegrity
        : Math.min(run.minimumIntegrity, observation.minimumIntegrity),
    detected:
      run.detected ||
      result.progress.suspicion >= 150 ||
      result.progress.children.some((child) => child.suspicion >= 150),
    hint: Math.max(
      run.hint,
      observation.tick - progressTick >= 1350
        ? 2
        : observation.tick - progressTick >= 600
          ? 1
          : 0,
    ),
  };
  if (
    definition.id === "M17" &&
    stage.objective.kind === "interact" &&
    stage.objective.target === "laatste-upload"
  ) {
    if (run.objective.ticks > 0 && !result.advanced && !result.progress.done)
      next.inventory = [...new Set([...next.inventory, "upload-onderbroken"])];
    if (result.progress.done && !next.inventory.includes("upload-onderbroken"))
      next.inventory = [
        ...new Set([...next.inventory, "ononderbroken-upload"]),
      ];
  }
  if (result.failure)
    return { ...next, status: "failed", failure: result.failure };
  const deadline = Math.min(
    definition.deadlineSeconds
      ? run.startedTick + definition.deadlineSeconds * 30
      : Infinity,
    stage.deadlineSeconds
      ? run.stageTick + stage.deadlineSeconds * 30
      : Infinity,
  );
  if (
    observation.tick > deadline ||
    (!result.progress.done && observation.tick === deadline)
  )
    return { ...next, status: "failed", failure: "De tijd is om." };
  if (!result.progress.done) return next;
  const stageIndex = stage.next
    ? definition.stages.findIndex((candidate) => candidate.id === stage.next)
    : run.stage + 1;
  if (stageIndex === definition.stages.length)
    return { ...next, status: "completed" };
  if (stageIndex < 0)
    return {
      ...next,
      status: "failed",
      failure: "De volgende missiestap ontbreekt.",
    };
  return {
    ...next,
    stage: stageIndex,
    stageTick: observation.tick,
    progressTick: observation.tick,
    hint: 0,
    objective: emptyObjectiveProgress(),
    checkpoint: stage.checkpoint
      ? { stage: stageIndex, inventory: [...next.inventory] }
      : run.checkpoint,
  };
}

/** Requests the next hint without changing objectives, timers or rewards. */
export function revealMissionHint(run: MissionRun): MissionRun {
  return { ...run, hint: Math.min(2, run.hint + 1) };
}

/** Restores a solo checkpoint, retaining the contract's identity and elapsed time. */
export function retryMission(
  definition: MissionDefinition,
  run: MissionRun,
  tick: number,
  solo: boolean,
): MissionRun {
  if (run.status !== "failed") return run;
  if (!solo || !run.checkpoint)
    return startMission(
      definition,
      run.ownerId,
      run.contractId,
      tick,
      run.replay,
    );
  return {
    ...run,
    status: "active",
    stage: run.checkpoint.stage,
    inventory: [...run.checkpoint.inventory],
    stageTick: tick,
    lastTick: tick,
    progressTick: tick,
    hint: 0,
    objective: emptyObjectiveProgress(),
    failure: null,
  };
}
