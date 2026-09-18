import { distance, distancePointToSegment } from "../mapBuild/geometry";
import type {
  MissionObjective,
  MissionObservation,
  ObjectiveProgress,
  PrimitiveObjective,
} from "./types";

/** Fresh progress for a stage, also used when restoring a checkpoint. */
export function emptyObjectiveProgress(): ObjectiveProgress {
  return {
    ticks: 0,
    gate: 0,
    collected: [],
    suspicion: 0,
    lostTicks: 0,
    children: [],
    done: false,
  };
}

/** Objective result and inventory changes; the runner applies these atomically. */
export type ObjectiveResult = {
  progress: ObjectiveProgress;
  collected: string[];
  consumed: string[];
  failure: string | null;
  advanced: boolean;
};

function stepPrimitive(
  objective: PrimitiveObjective,
  previous: ObjectiveProgress,
  observation: MissionObservation,
  inventory: readonly string[],
): ObjectiveResult {
  const progress = { ...previous, collected: [...previous.collected] };
  const result: ObjectiveResult = {
    progress,
    collected: [],
    consumed: [],
    failure: null,
    advanced: false,
  };
  if (previous.done) return result;
  const target =
    "target" in objective ? observation.targets[objective.target] : undefined;
  const gap = target
    ? distance(observation.position, target.position)
    : Infinity;
  const withinReach =
    target?.alive && gap <= 3 && observation.vehicleId === null;
  const countHold = (
    condition: boolean,
    seconds: number,
    reset = false,
  ): void => {
    if (condition) progress.ticks += 1;
    else if (reset) progress.ticks = 0;
    progress.done = progress.ticks >= Math.round(seconds * 30);
  };
  switch (objective.kind) {
    case "talk":
      progress.done = Boolean(withinReach && observation.interacted);
      break;
    case "reach":
      progress.done = Boolean(
        target?.alive &&
        gap <= objective.radius &&
        (!objective.stopped || observation.speed < 0.5) &&
        (!objective.vehicle ||
          observation.vehicleId ===
            observation.targets[objective.vehicle]?.id) &&
        (objective.driving === undefined ||
          objective.driving === (observation.vehicleId !== null)),
      );
      break;
    case "interact":
      countHold(
        Boolean(
          target?.alive &&
          gap <= 3 &&
          observation.interacting &&
          observation.speed < 0.5,
        ),
        objective.seconds,
      );
      break;
    case "collect":
      for (const reference of objective.targets) {
        const item = observation.targets[reference];
        if (
          !item?.alive ||
          progress.collected.includes(reference) ||
          !observation.interacted ||
          observation.vehicleId !== null ||
          distance(observation.position, item.position) > 3
        )
          continue;
        progress.collected.push(reference);
        result.collected.push(reference);
        break;
      }
      progress.done = objective.targets.every((reference) =>
        progress.collected.includes(reference),
      );
      break;
    case "deliver":
      progress.done = Boolean(
        target?.alive &&
        gap <= 4 &&
        observation.interacted &&
        observation.speed < 0.5 &&
        objective.items.every((item) => inventory.includes(item)) &&
        (!objective.vehicle ||
          observation.vehicleId === observation.targets[objective.vehicle]?.id),
      );
      if (progress.done) result.consumed = objective.items;
      break;
    case "enterVehicle":
      progress.done = Boolean(
        target?.alive && observation.vehicleId === target.id,
      );
      break;
    case "hijackVehicle":
      progress.done = Boolean(
        target?.alive &&
        observation.vehicleId === target.id &&
        observation.hijackedVehicleIds.includes(target.id),
      );
      break;
    case "driveCheckpoints": {
      const gate = objective.gates[progress.gate];
      const centre = gate && observation.targets[gate.target];
      if (
        centre?.alive &&
        observation.vehicleId !== null &&
        (!objective.vehicle ||
          observation.vehicleId ===
            observation.targets[objective.vehicle]?.id) &&
        !observation.teleported &&
        distancePointToSegment(
          centre.position,
          observation.previousPosition,
          observation.position,
        ) <= gate.radius
      )
        progress.gate += 1;
      progress.done = progress.gate === objective.gates.length;
      break;
    }
    case "follow": {
      if (target && !target.alive)
        result.failure = "Je doelwit is uitgeschakeld.";
      const visible = Boolean(target?.alive && gap <= objective.maximumM);
      progress.suspicion = Math.max(
        0,
        Math.min(150, progress.suspicion + (gap < objective.minimumM ? 1 : -1)),
      );
      progress.lostTicks = visible ? 0 : progress.lostTicks + 1;
      countHold(visible && gap >= objective.minimumM, objective.seconds);
      if (progress.suspicion >= 150)
        result.failure = "Je bent ontdekt. Houd meer afstand.";
      if (progress.lostTicks >= 900)
        result.failure = "Je bent het doelwit kwijtgeraakt.";
      break;
    }
    case "identify":
      progress.done = Boolean(
        withinReach &&
        observation.interacted &&
        objective.clues.every((clue) => target?.clues?.includes(clue)),
      );
      break;
    case "eliminate": {
      const kill =
        target &&
        observation.kills.find((event) => event.victimId === target.id);
      progress.done = kill?.killerId === observation.playerId;
      if (target && !target.alive && !progress.done)
        result.failure = "Je doelwit is door iemand anders uitgeschakeld.";
      break;
    }
    case "escort": {
      const destination = observation.targets[objective.destination];
      if (target && !target.alive)
        result.failure = "Je passagier heeft het niet overleefd.";
      progress.lostTicks =
        gap <= objective.separationM ? 0 : progress.lostTicks + 1;
      if (progress.lostTicks >= 900)
        result.failure = "Je hebt je passagier achtergelaten.";
      progress.done = Boolean(
        target?.alive &&
        destination?.alive &&
        target.vehicleId == null &&
        distance(target.position, destination.position) <= objective.radius &&
        gap <= objective.separationM,
      );
      break;
    }
    case "defend":
      if (target && !target.alive)
        result.failure = "Het doel dat je moest beschermen is vernietigd.";
      countHold(Boolean(target?.alive && gap <= 60), objective.seconds);
      break;
    case "escapeWanted": {
      const area = objective.outside
        ? observation.targets[objective.outside]
        : undefined;
      const outside =
        !objective.outside ||
        Boolean(
          area &&
          distance(observation.position, area.position) >
            (objective.radius ?? 40),
        );
      countHold(observation.wanted === 0 && outside, objective.seconds, true);
      break;
    }
  }
  result.advanced =
    progress.done ||
    progress.gate > previous.gate ||
    progress.ticks > previous.ticks ||
    progress.collected.length > previous.collected.length;
  return result;
}

/** Evaluates one tick; a composite cannot reuse one interaction for several handovers. */
export function stepObjective(
  objective: MissionObjective,
  previous: ObjectiveProgress,
  observation: MissionObservation,
  inventory: readonly string[],
): ObjectiveResult {
  if (objective.kind !== "composite")
    return stepPrimitive(objective, previous, observation, inventory);
  const results: ObjectiveResult[] = [];
  let interactionUsed = false;
  let carried = [...inventory];
  objective.objectives.forEach((child, index) => {
    const childPrevious = previous.children[index] ?? emptyObjectiveProgress();
    const result = stepPrimitive(
      child,
      childPrevious,
      {
        ...observation,
        interacted: observation.interacted && !interactionUsed,
      },
      carried,
    );
    if (!childPrevious.done && result.advanced && observation.interacted)
      interactionUsed = true;
    carried = [
      ...carried.filter((item) => !result.consumed.includes(item)),
      ...result.collected,
    ];
    results.push(result);
  });
  return {
    progress: {
      ...previous,
      children: results.map((result) => result.progress),
      done: results.every((result) => result.progress.done),
    },
    collected: results.flatMap((result) => result.collected),
    consumed: results.flatMap((result) => result.consumed),
    failure: results.find((result) => result.failure)?.failure ?? null,
    advanced: results.some((result) => result.advanced),
  };
}
