import type { VehicleKind } from "../sim/types";
import type { MissionDefinition, PrimitiveObjective } from "./types";

/** An actor has a stable alias; the host allocates its entity ID for each contract. */
export type MissionActorSpec = {
  alias: string;
  kind: "person" | "vehicle" | "prop";
  behavior: "wait" | "route" | "escort" | "hostile";
  fromStage: number;
  untilStage?: number;
  vehicleKind?: VehicleKind;
  clues?: string[];
  route?: string[];
  protects?: string;
  armedFromStage?: number;
  behaviorFromStage?: number;
};
/** Mechanical world configuration accompanying authored dialogue. */
export type MissionScenario = {
  actors: MissionActorSpec[];
  heatStages: number[];
  attachment: Record<string, string>;
  minimumVehicleIntegrity?: number;
  coolingPerSecond?: number;
  recharge?: string;
  optionalPickup?: { alias: string; label: string };
  radioStages?: Record<number, string>;
};

/** Flattens authored primitives with their stage index for world binding and content validation. */
export function missionPrimitives(
  definition: MissionDefinition,
): { stage: number; objective: PrimitiveObjective }[] {
  return definition.stages.flatMap((stage, index) =>
    (stage.objective.kind === "composite"
      ? stage.objective.objectives
      : [stage.objective]
    ).map((objective) => ({ stage: index, objective })),
  );
}

const VEHICLE_KINDS: Record<string, VehicleKind> = {
  bus: "van",
  truck: "van",
  transport: "van",
  sedan: "sedan",
  leiderwagen: "sedan",
  auto: "oldtimer",
  vluchtauto: "compact",
  racewagen: "sport",
};

/** Resolves mission entities and scripted pressure from the authored goal sequence. */
export function missionScenario(
  definition: MissionDefinition,
): MissionScenario {
  const parts = missionPrimitives(definition);
  const actors = new Map<string, MissionActorSpec>();
  for (const { objective } of parts) {
    if (objective.kind !== "enterVehicle" && objective.kind !== "hijackVehicle")
      continue;
    const moving = objective.kind === "hijackVehicle";
    actors.set(objective.target, {
      alias: objective.target,
      kind: "vehicle",
      behavior: moving ? "route" : "wait",
      fromStage: 0,
      vehicleKind: VEHICLE_KINDS[objective.target] ?? "sedan",
      ...(moving
        ? {
            route: [
              `${objective.target}-route-1`,
              `${objective.target}-route-2`,
              objective.target,
            ],
          }
        : {}),
    });
  }
  for (const { stage, objective } of parts) {
    if (
      !(
        [
          "talk",
          "identify",
          "eliminate",
          "follow",
          "escort",
          "defend",
        ] as string[]
      ).includes(objective.kind) ||
      !("target" in objective)
    )
      continue;
    const existing = actors.get(objective.target);
    if (existing?.kind === "vehicle") continue;
    const convoy = objective.target === "leiderwagen";
    const behavior =
      objective.kind === "escort"
        ? "escort"
        : objective.kind === "follow"
          ? "route"
          : (existing?.behavior ?? "wait");
    actors.set(objective.target, {
      alias: objective.target,
      kind: convoy
        ? "vehicle"
        : objective.kind === "defend"
          ? "prop"
          : "person",
      vehicleKind: convoy ? "sedan" : undefined,
      behavior,
      behaviorFromStage:
        objective.kind === "follow" ? stage : existing?.behaviorFromStage,
      fromStage: Math.min(
        stage,
        existing?.fromStage ?? stage,
        parts.find(
          ({ objective: earlier }) =>
            "target" in earlier && earlier.target === objective.target,
        )?.stage ?? stage,
      ),
      clues: objective.kind === "identify" ? objective.clues : existing?.clues,
      ...(behavior === "route"
        ? {
            route: [
              `${objective.target}-route-1`,
              `${objective.target}-route-2`,
            ],
          }
        : {}),
    });
    if (objective.kind === "defend") {
      for (let i = 1; i <= 2; i++)
        actors.set(`aanvaller-${stage}-${i}`, {
          alias: `aanvaller-${stage}-${i}`,
          kind: "person",
          behavior: "hostile",
          fromStage: stage,
          untilStage: stage + 1,
          protects: objective.target,
        });
    }
  }
  for (const [alias, actor] of actors) {
    const attack = parts.find(
      (entry) =>
        entry.objective.kind === "eliminate" &&
        entry.objective.target === alias,
    );
    if (attack) actor.armedFromStage = attack.stage;
    if (actor.behavior === "escort") actor.fromStage = 0;
    if (alias === definition.contact) actors.delete(alias);
  }
  if (definition.id === "M04") actors.get("racewagen")!.vehicleKind = "compact";
  if (definition.id === "M11")
    actors.set("dubbelganger", {
      alias: "dubbelganger",
      kind: "person",
      behavior: "wait",
      fromStage: 1,
      untilStage: 3,
      clues: ["rode-jas"],
    });
  if (definition.id === "M12")
    for (let i = 1; i <= 2; i++)
      actors.set(`escorte-${i}`, {
        alias: `escorte-${i}`,
        kind: "vehicle",
        behavior: "route",
        fromStage: 0,
        vehicleKind: "sedan",
        route: ["leiderwagen-route-1", "leiderwagen-route-2"],
      });
  if (definition.id === "M21")
    actors.set("bewaker", {
      alias: "bewaker",
      kind: "person",
      behavior: "route",
      fromStage: 0,
      route: ["bewaker-route-1", "bewaker-route-2"],
    });
  const heat: Record<string, number[]> = {
    M06: [2],
    M07: [1],
    M08: [2],
    M09: [3],
    M17: [2],
    M20: [4],
  };
  return {
    actors: [...actors.values()],
    heatStages: heat[definition.id] ?? [],
    attachment:
      definition.id === "M08"
        ? {
            laadruimte: "transport",
            "tas-1": "transport",
            "tas-2": "transport",
          }
        : {},
    minimumVehicleIntegrity: definition.id === "M05" ? 25 : undefined,
    coolingPerSecond: definition.id === "M13" ? 0.12 : undefined,
    recharge: definition.id === "M13" ? "koelstation" : undefined,
    optionalPickup:
      definition.id === "M16"
        ? { alias: "vierde-opname", label: "Extra opname maken" }
        : definition.id === "M23"
          ? { alias: "panorama", label: "Optionele uitzichtfoto maken" }
          : undefined,
    radioStages:
      definition.id === "M20"
        ? {
            1: "De heilige bas",
            2: "Gekookt in het licht",
            3: "De heilige bas",
          }
        : definition.id === "M24"
          ? { 8: "Onder dezelfde zon" }
          : undefined,
  };
}
