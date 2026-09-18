import { describe, expect, it } from "vitest";
import { MISSION_CATALOG, missionById, validateMissionGraph } from "./catalog";
import { MISSION_CONTACTS } from "./contacts";
import { missionPrimitives, missionScenario } from "./scenarios";
import { missionTargets } from "./targets";

describe("the authored city contracts", () => {
  it("offers six complete jobs per district through eight reachable contact chains", () => {
    expect(MISSION_CATALOG).toHaveLength(24);
    expect(new Set(MISSION_CATALOG.map((entry) => entry.id)).size).toBe(24);
    for (const zone of ["rhenen", "wageningen", "campus", "bennekom"])
      expect(
        MISSION_CATALOG.filter((entry) => entry.zone === zone),
      ).toHaveLength(6);
    for (const contact of MISSION_CONTACTS) {
      expect(contact.missions).toHaveLength(3);
      for (const id of contact.missions)
        expect(missionById(id)?.contact).toBe(contact.id);
    }
    const unlocked = new Set<string>();
    for (let i = 0; i < 24; i++)
      for (const mission of MISSION_CATALOG)
        if (mission.prerequisites.every((id) => unlocked.has(id)))
          unlocked.add(mission.id);
    expect(unlocked.size).toBe(24);
  });

  it.each(MISSION_CATALOG)(
    "$id has resolved targets and a complete objective path",
    (mission) => {
      expect(validateMissionGraph(mission)).toEqual([]);
      const targets = missionTargets(mission);
      for (const { objective } of missionPrimitives(mission)) {
        const references = [
          ...("target" in objective ? [objective.target] : []),
          ...(objective.kind === "collect" ? objective.targets : []),
          ...(objective.kind === "driveCheckpoints"
            ? objective.gates.map((gate) => gate.target)
            : []),
          ...(objective.kind === "escort" ? [objective.destination] : []),
          ...(objective.kind === "escapeWanted" && objective.outside
            ? [objective.outside]
            : []),
        ];
        for (const reference of references)
          expect(
            targets[reference],
            `${mission.id}:${reference}`,
          ).toBeDefined();
      }
      for (const actor of missionScenario(mission).actors)
        for (const reference of [actor.alias, ...(actor.route ?? [])])
          expect(
            targets[reference],
            `${mission.id}:${reference}`,
          ).toBeDefined();
      for (const stage of mission.stages) {
        expect(stage.hints).toHaveLength(2);
        expect(stage.dialogue.length).toBeGreaterThan(0);
      }
    },
  );
});
