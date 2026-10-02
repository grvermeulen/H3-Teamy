import type { MapIndex } from "../world/mapTypes";
import { landmarkCentreMetres, zoneCentreMetres } from "../world/zone";
import type { Point } from "../world/projection";
import type { MissionAnchorDefinition } from "./anchors";
import { MISSION_CONTACTS } from "./contacts";
import { missionPrimitives, missionScenario } from "./scenarios";
import type { MissionDefinition } from "./types";

const CIRCUIT: Point[] = [
  [-170, -160],
  [-30, -230],
  [140, -150],
  [235, -20],
  [175, 135],
  [30, 210],
  [-150, 150],
  [-225, 0],
  [-155, -85],
  [0, -120],
];
const LANDMARK: Record<MissionDefinition["zone"], string> = {
  rhenen: "cunerakerk",
  wageningen: "grote-kerk-wageningen",
  campus: "wur-forum",
  bennekom: "oude-kerk-bennekom",
};

/** Produces desired locations, subsequently checked against real roads, buildings and zone limits. */
export function missionLocationDefinitions(
  definition: MissionDefinition,
  index: MapIndex,
): MissionAnchorDefinition[] {
  const scenario = missionScenario(definition);
  const modes = new Map<string, "foot" | "vehicle">();
  const firstPickups = new Set<string>();
  if (scenario.recharge) modes.set(scenario.recharge, "foot");
  if (scenario.optionalPickup) modes.set(scenario.optionalPickup.alias, "foot");
  for (const { stage, objective } of missionPrimitives(definition)) {
    if ("target" in objective)
      modes.set(
        objective.target,
        objective.kind === "enterVehicle" ||
          objective.kind === "hijackVehicle" ||
          (objective.kind === "reach" && objective.driving)
          ? "vehicle"
          : (modes.get(objective.target) ?? "foot"),
      );
    if (objective.kind === "collect")
      for (const target of objective.targets) {
        modes.set(target, "foot");
        if (stage === 0) firstPickups.add(target);
      }
    if (objective.kind === "deliver") {
      if (objective.vehicle) modes.set(objective.vehicle, "vehicle");
      for (const item of objective.items)
        if (!modes.has(item)) modes.set(item, "foot");
    }
    if (objective.kind === "driveCheckpoints")
      for (const gate of objective.gates) modes.set(gate.target, "vehicle");
    if (objective.kind === "escort") modes.set(objective.destination, "foot");
    if (objective.kind === "escapeWanted" && objective.outside)
      modes.set(objective.outside, "foot");
  }
  for (const actor of scenario.actors) {
    modes.set(actor.alias, actor.kind === "vehicle" ? "vehicle" : "foot");
    for (const alias of actor.route ?? [])
      modes.set(alias, actor.kind === "vehicle" ? "vehicle" : "foot");
  }
  const landmark = LANDMARK[definition.zone];
  const origin = landmarkCentreMetres(
    index.landmarks.find((entry) => entry.key === landmark)!,
  );
  const centre = zoneCentreMetres(
    index.zones.find((entry) => entry.key === definition.zone)!,
  );
  const contact = MISSION_CONTACTS.find(
    (entry) => entry.id === definition.contact,
  )!;
  const local: Point = [centre[0] - origin[0], centre[1] - origin[1]];
  const seed = Number(definition.id.slice(1));
  return [...modes].map(([alias, mode], i): MissionAnchorDefinition => {
    const person = MISSION_CONTACTS.find((entry) => entry.id === alias);
    if (person || firstPickups.has(alias)) {
      const at = person ?? contact;
      return {
        id: `${definition.id}:${alias}`,
        zone: definition.zone,
        landmark: at.landmark,
        offset: [
          at.offset[0] + (person ? 0 : 2 + i * 1.5),
          at.offset[1] + (person ? 0 : 2),
        ],
        mode,
      };
    }
    if (alias === "atlas" || alias === "ingang")
      return {
        id: `${definition.id}:${alias}`,
        zone: definition.zone,
        landmark: "wur-atlas",
        offset: alias === "ingang" ? [18, 12] : [35, 20],
        mode,
      };
    const gate = /^(poort|slalom|upload)-(\d+)$/.exec(alias);
    const point =
      CIRCUIT[
        gate
          ? (Number(gate[2]) - 1 + (seed % 4)) % CIRCUIT.length
          : (i * 3 + seed) % CIRCUIT.length
      ];
    return {
      id: `${definition.id}:${alias}`,
      zone: definition.zone,
      landmark,
      offset: [local[0] + point[0], local[1] + point[1]],
      mode,
    };
  });
}
