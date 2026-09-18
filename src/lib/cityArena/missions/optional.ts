import { distance } from "../mapBuild/geometry";
import type { ArenaPlayerState, ArenaState } from "../sim/types";
import { missionById } from "./catalog";
import { missionScenario } from "./scenarios";
import { missionTargets } from "./targets";

/** Optional detours remain available alongside the current mandatory objective. */
export function optionalMissionAction(
  player: ArenaPlayerState,
  state?: Pick<ArenaState, "peds" | "vehicles">,
): { alias: string; label: string; recharge: boolean } | null {
  const profile = player.mission;
  const run = profile?.run;
  const definition = run && missionById(run.definitionId);
  if (!run || !definition || run.status !== "active" || player.speed > 0.5)
    return null;
  const scenario = missionScenario(definition);
  const targets = missionTargets(definition, state, profile);
  const pickup = scenario.optionalPickup;
  const options = [
    ...(scenario.recharge
      ? [
          {
            alias: scenario.recharge,
            label: "Koeling bijladen (vasthouden)",
            recharge: true,
          },
        ]
      : []),
    ...(pickup &&
    player.vehicleId === null &&
    !run.inventory.includes(pickup.alias)
      ? [{ ...pickup, recharge: false }]
      : []),
  ];
  return (
    options.find(
      (entry) =>
        targets[entry.alias] &&
        distance([player.x, player.y], targets[entry.alias].position) <= 3,
    ) ?? null
  );
}
