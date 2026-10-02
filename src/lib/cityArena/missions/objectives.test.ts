import { describe, expect, it } from "vitest";
import { emptyObjectiveProgress, stepObjective } from "./objectives";
import { observation } from "./testing/fixtures";
import type { MissionObjective, MissionObservation } from "./types";

function runFor(
  objective: MissionObjective,
  ticks: number,
  facts: Partial<MissionObservation> = {},
) {
  let result = stepObjective(
    objective,
    emptyObjectiveProgress(),
    observation(facts),
    [],
  );
  for (let tick = 1; tick < ticks; tick++)
    result = stepObjective(
      objective,
      result.progress,
      observation({ ...facts, tick: tick + 1 }),
      [],
    );
  return result;
}

describe("mission objective mechanics", () => {
  it("detects a fast car crossing a checkpoint between ticks, but refuses teleport shortcuts", () => {
    const objective: MissionObjective = {
      kind: "driveCheckpoints",
      gates: [
        { target: "note", radius: 2 },
        { target: "old-door", radius: 2 },
      ],
    };
    const crossing = observation({
      vehicleId: 42,
      previousPosition: [-10, 0],
      position: [10, 0],
    });
    const first = stepObjective(
      objective,
      emptyObjectiveProgress(),
      crossing,
      [],
    );
    expect(first.progress).toMatchObject({ gate: 1, done: false });
    const second = stepObjective(
      objective,
      first.progress,
      { ...crossing, previousPosition: [90, 0], position: [110, 0] },
      [],
    );
    expect(second.progress.done).toBe(true);
    expect(
      stepObjective(
        objective,
        emptyObjectiveProgress(),
        { ...crossing, teleported: true },
        [],
      ).progress.gate,
    ).toBe(0);
    expect(
      stepObjective(
        objective,
        emptyObjectiveProgress(),
        { ...crossing, vehicleId: null },
        [],
      ).progress.gate,
    ).toBe(0);
  });

  it("requires the correct target identity and the player's own kill", () => {
    const facts = observation({
      targets: {
        target: {
          id: 99,
          alive: true,
          position: [0, 0],
          clues: ["rode-jas", "zilveren-koffer"],
        },
      },
      interacted: true,
    });
    const identify: MissionObjective = {
      kind: "identify",
      target: "target",
      clues: ["rode-jas", "zilveren-koffer"],
    };
    expect(
      stepObjective(identify, emptyObjectiveProgress(), facts, []).progress
        .done,
    ).toBe(true);
    expect(
      stepObjective(
        identify,
        emptyObjectiveProgress(),
        {
          ...facts,
          targets: { target: { ...facts.targets.target, clues: ["rode-jas"] } },
        },
        [],
      ).progress.done,
    ).toBe(false);
    const eliminate: MissionObjective = { kind: "eliminate", target: "target" };
    expect(
      stepObjective(
        eliminate,
        emptyObjectiveProgress(),
        { ...facts, kills: [{ victimId: 100, killerId: 0 }] },
        [],
      ).progress.done,
    ).toBe(false);
    expect(
      stepObjective(
        eliminate,
        emptyObjectiveProgress(),
        { ...facts, kills: [{ victimId: 99, killerId: 0 }] },
        [],
      ).progress.done,
    ).toBe(true);
    const stolen = stepObjective(
      eliminate,
      emptyObjectiveProgress(),
      {
        ...facts,
        targets: { target: { ...facts.targets.target, alive: false } },
        kills: [{ victimId: 99, killerId: 1 }],
      },
      [],
    );
    expect(stolen.failure).toBe(
      "Je doelwit is door iemand anders uitgeschakeld.",
    );
  });

  it("pauses an upload outside the area without discarding earned progress", () => {
    const objective: MissionObjective = {
      kind: "interact",
      target: "note",
      seconds: 2,
    };
    const halfway = runFor(objective, 30, { interacting: true });
    const away = stepObjective(
      objective,
      halfway.progress,
      observation({ position: [20, 0], interacting: true }),
      [],
    );
    expect(away.progress.ticks).toBe(30);
    let finish = away;
    for (let tick = 0; tick < 30; tick++)
      finish = stepObjective(
        objective,
        finish.progress,
        observation({ interacting: true }),
        [],
      );
    expect(finish.progress.done).toBe(true);
  });

  it("requires stopping and the specified vehicle for a cargo handover", () => {
    const objective: MissionObjective = {
      kind: "deliver",
      target: "note",
      items: ["parcel"],
      vehicle: "van",
    };
    const facts = observation({
      vehicleId: 77,
      interacted: true,
      targets: {
        note: { id: 102, alive: true, position: [0, 0] },
        van: { id: 77, alive: true, position: [0, 0] },
      },
    });
    expect(
      stepObjective(objective, emptyObjectiveProgress(), facts, []).progress
        .done,
    ).toBe(false);
    expect(
      stepObjective(
        objective,
        emptyObjectiveProgress(),
        { ...facts, speed: 5 },
        ["parcel"],
      ).progress.done,
    ).toBe(false);
    expect(
      stepObjective(
        objective,
        emptyObjectiveProgress(),
        { ...facts, vehicleId: 78 },
        ["parcel"],
      ).progress.done,
    ).toBe(false);
    expect(
      stepObjective(objective, emptyObjectiveProgress(), facts, ["parcel"])
        .consumed,
    ).toEqual(["parcel"]);
  });

  it("requires an actual completed hijack of the bound vehicle", () => {
    const objective: MissionObjective = {
      kind: "hijackVehicle",
      target: "sedan",
    };
    const facts = observation({
      vehicleId: 42,
      targets: { sedan: { id: 42, position: [0, 0], alive: true } },
    });
    expect(
      stepObjective(objective, emptyObjectiveProgress(), facts, []).progress
        .done,
    ).toBe(false);
    expect(
      stepObjective(
        objective,
        emptyObjectiveProgress(),
        { ...facts, hijackedVehicleIds: [43] },
        [],
      ).progress.done,
    ).toBe(false);
    expect(
      stepObjective(
        objective,
        emptyObjectiveProgress(),
        { ...facts, hijackedVehicleIds: [42] },
        [],
      ).progress.done,
    ).toBe(true);
  });

  it("requires following from a safe distance and fails sustained close pursuit", () => {
    const objective: MissionObjective = {
      kind: "follow",
      target: "note",
      minimumM: 20,
      maximumM: 60,
      seconds: 2,
    };
    expect(runFor(objective, 60, { position: [30, 0] }).progress.done).toBe(
      true,
    );
    expect(runFor(objective, 150).failure).toBe(
      "Je bent ontdekt. Houd meer afstand.",
    );
    expect(runFor(objective, 900, { position: [90, 0] }).failure).toBe(
      "Je bent het doelwit kwijtgeraakt.",
    );
  });

  it("requires passengers to leave the car at the destination and survive the escort", () => {
    const objective: MissionObjective = {
      kind: "escort",
      target: "passenger",
      destination: "note",
      radius: 4,
      separationM: 30,
    };
    const facts = observation({
      targets: {
        passenger: { id: 22, position: [0, 0], alive: true, vehicleId: 42 },
        note: { id: 102, position: [0, 0], alive: true },
      },
    });
    expect(
      stepObjective(objective, emptyObjectiveProgress(), facts, []).progress
        .done,
    ).toBe(false);
    const arrived = {
      ...facts,
      targets: {
        ...facts.targets,
        passenger: { ...facts.targets.passenger, vehicleId: null },
      },
    };
    expect(
      stepObjective(objective, emptyObjectiveProgress(), arrived, []).progress
        .done,
    ).toBe(true);
    expect(
      stepObjective(
        objective,
        emptyObjectiveProgress(),
        {
          ...arrived,
          targets: {
            ...arrived.targets,
            passenger: { ...arrived.targets.passenger, alive: false },
          },
        },
        [],
      ).failure,
    ).toBe("Je passagier heeft het niet overleefd.");
  });

  it("fails defence when the protected object is destroyed and restarts escape time on renewed heat", () => {
    const defend: MissionObjective = {
      kind: "defend",
      target: "note",
      seconds: 1,
    };
    expect(runFor(defend, 30).progress.done).toBe(true);
    expect(
      stepObjective(
        defend,
        emptyObjectiveProgress(),
        observation({
          targets: { note: { id: 102, alive: false, position: [0, 0] } },
        }),
        [],
      ).failure,
    ).toBe("Het doel dat je moest beschermen is vernietigd.");
    const escape: MissionObjective = {
      kind: "escapeWanted",
      seconds: 2,
      outside: "note",
      radius: 40,
    };
    const halfway = runFor(escape, 30, { position: [50, 0] });
    const spotted = stepObjective(
      escape,
      halfway.progress,
      observation({ position: [50, 0], wanted: 1 }),
      [],
    );
    expect(spotted.progress.ticks).toBe(0);
    expect(runFor(escape, 60).progress.done).toBe(false);
    expect(runFor(escape, 60, { position: [50, 0] }).progress.done).toBe(true);
  });

  it("cannot collect and hand over an item with the same action in a composite", () => {
    const objective: MissionObjective = {
      kind: "composite",
      objectives: [
        { kind: "collect", targets: ["parcel"] },
        { kind: "deliver", target: "note", items: ["parcel"] },
      ],
    };
    const first = stepObjective(
      objective,
      emptyObjectiveProgress(),
      observation({ interacted: true }),
      [],
    );
    expect(first.progress.done).toBe(false);
    expect(first.collected).toEqual(["parcel"]);
    expect(first.consumed).toEqual([]);
    const second = stepObjective(
      objective,
      first.progress,
      observation({ interacted: true }),
      ["parcel"],
    );
    expect(second.progress.done).toBe(true);
    expect(second.consumed).toEqual(["parcel"]);
    const repeated = stepObjective(
      objective,
      second.progress,
      observation({ interacted: true }),
      [],
    );
    expect(repeated.collected).toEqual([]);
    expect(repeated.consumed).toEqual([]);
  });
});
