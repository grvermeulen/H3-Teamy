import type { ArenaState } from "../sim/types";
import { localToWorld } from "../sim/vehicle";
import type { Point } from "../world/projection";
import generated from "./anchors.generated.json";
import { missionScenario } from "./scenarios";
import type { MissionDefinition, MissionProfile, MissionTarget } from "./types";

/** A location validated against the shipped map during the content build. */
export function missionAnchor(id: string): Point | null {
  const anchor = generated.anchors.find((entry) => entry.id === id);
  return anchor ? [anchor.position[0], anchor.position[1]] : null;
}

/** Road heading at a validated anchor, used to place cars parallel to the street. */
export function missionHeading(id: string): number {
  return generated.anchors.find((entry) => entry.id === id)?.heading ?? 0;
}

/** Resolves authored aliases to current world entities; clients cannot choose target IDs. */
export function missionTargets(
  definition: MissionDefinition,
  state?: Pick<ArenaState, "peds" | "vehicles">,
  profile?: MissionProfile,
): Record<string, MissionTarget> {
  const prefix = `${definition.id}:`;
  const targets: Record<string, MissionTarget> = Object.fromEntries(
    generated.anchors.flatMap((anchor, index) =>
      anchor.id.startsWith(prefix)
        ? [
            [
              anchor.id.slice(prefix.length),
              {
                id: -(index + 1),
                position: [anchor.position[0], anchor.position[1]] as Point,
                alive: true,
              },
            ],
          ]
        : [],
    ),
  );
  if (!state || !profile) return targets;
  const scenario = missionScenario(definition);
  for (const actor of scenario.actors) {
    const binding = profile.actors?.[actor.alias];
    const entity =
      actor.kind === "vehicle"
        ? state.vehicles.find((entry) => entry.id === binding?.id)
        : state.peds.find((entry) => entry.id === binding?.id);
    const fallback = targets[actor.alias];
    if (!fallback) continue;
    targets[actor.alias] = {
      ...fallback,
      id: binding?.id ?? fallback.id,
      position: entity ? [entity.x, entity.y] : fallback.position,
      alive: Boolean(entity && entity.health > 0),
      clues: actor.clues,
      vehicleId: binding?.vehicleId,
    };
  }
  for (const [alias, vehicleAlias] of Object.entries(scenario.attachment)) {
    const vehicle = state.vehicles.find(
      (entry) => entry.id === profile.actors?.[vehicleAlias]?.id,
    );
    if (vehicle && targets[alias])
      targets[alias] = {
        ...targets[alias],
        position: localToWorld(vehicle, [-3, alias === "tas-2" ? 1 : 0]),
        alive: !vehicle.wrecked,
      };
  }
  return targets;
}
