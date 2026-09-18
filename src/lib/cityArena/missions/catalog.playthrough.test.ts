import { describe, expect, it } from "vitest";
import { MISSION_CATALOG } from "./catalog";
import { missionTargets } from "./targets";
import { missionScenario } from "./scenarios";
import { emptyObjectiveProgress } from "./objectives";
import { startMission, stepMission } from "./runner";
import { settleMission } from "./rewards";
import { observation } from "./testing/fixtures";

describe("authored mission inventory and stage sequences", () => {
  it.each(MISSION_CATALOG)(
    "$id reaches one payout using its authored objectives",
    (definition) => {
      let run = startMission(definition, 0, `${definition.id}:test`, 0);
      const targets = missionTargets(definition);
      Object.values(targets).forEach((target, i) => {
        target.id = i + 1;
      });
      for (const actor of missionScenario(definition).actors)
        if (targets[actor.alias]) targets[actor.alias].clues = actor.clues;
      for (let tick = 1; tick < 30_000 && run.status === "active"; tick++) {
        const stage = definition.stages[run.stage].objective;
        const child =
          stage.kind === "composite"
            ? stage.objectives.findIndex(
                (_, i) => !run.objective.children[i]?.done,
              )
            : -1;
        const objective =
          stage.kind === "composite" ? stage.objectives[child] : stage;
        const progress =
          child >= 0
            ? (run.objective.children[child] ?? emptyObjectiveProgress())
            : run.objective;
        const target =
          "target" in objective ? targets[objective.target] : undefined;
        const current = observation({
          tick,
          targets,
          position: target?.position ?? [0, 0],
          interacted: true,
          interacting: true,
        });
        if ("vehicle" in objective && objective.vehicle)
          current.vehicleId = targets[objective.vehicle].id;
        switch (objective.kind) {
          case "collect":
            current.position =
              targets[
                objective.targets.find(
                  (alias) => !progress.collected.includes(alias),
                )!
              ].position;
            break;
          case "enterVehicle":
            current.vehicleId = target!.id;
            break;
          case "hijackVehicle":
            current.vehicleId = target!.id;
            current.hijackedVehicleIds = [target!.id];
            break;
          case "driveCheckpoints":
            current.vehicleId ??= 1000;
            current.position =
              targets[objective.gates[progress.gate].target].position;
            break;
          case "reach":
            if (objective.driving) current.vehicleId ??= 1000;
            break;
          case "follow":
            current.position = [
              target!.position[0] +
                (objective.minimumM + objective.maximumM) / 2,
              target!.position[1],
            ];
            break;
          case "eliminate":
            current.kills = [{ victimId: target!.id, killerId: 0 }];
            break;
          case "escort":
            target!.position = targets[objective.destination].position;
            current.position = target!.position;
            break;
          case "escapeWanted":
            if (objective.outside)
              current.position = [
                targets[objective.outside].position[0] +
                  (objective.radius ?? 40) +
                  10,
                targets[objective.outside].position[1],
              ];
            break;
        }
        current.previousPosition = current.position;
        run = stepMission(definition, run, current);
      }
      expect({
        status: run.status,
        stage: run.stage,
        failure: run.failure,
      }).toEqual({
        status: "completed",
        stage: definition.stages.length - 1,
        failure: null,
      });
      const wallet = settleMission(
        { balance: 0, earned: 0, receipts: [] },
        definition,
        run,
      );
      expect(wallet.earned).toBeGreaterThanOrEqual(definition.basePay);
      expect(wallet.receipts).toHaveLength(1);
      expect(settleMission(wallet, definition, run)).toBe(wallet);
    },
  );
});
