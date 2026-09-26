import { describe, expect, it } from "vitest";
import { missionById } from "../missions/catalog";
import { MISSION_CONTACTS } from "../missions/contacts";
import { startMission } from "../missions/runner";
import type { MissionProfile } from "../missions/types";
import { emptyMissionProfile, missionAnchor } from "../missions/world";
import { createArenaPlayer } from "../sim/roster";
import type { ArenaPlayerState, PedState } from "../sim/types";
import { pedLookOf } from "./characterLooks";
import {
  CONTACT_UNAVAILABLE_COLOUR,
  MARKER_REFRESH_TICKS,
  OBJECTIVE_COLOUR,
  createMissionMarkers,
  type MissionMarkerScene,
} from "./missionMarkers";

const TICK = 1_000;
const [NOOR, , VERA] = MISSION_CONTACTS;

function you(mission?: MissionProfile): ArenaPlayerState {
  return { ...createArenaPlayer([0, 0], 0), id: 1, mission };
}

function sceneOf(parts: Partial<MissionMarkerScene> = {}): MissionMarkerScene {
  return {
    missionContacts: [NOOR!, VERA!],
    missionRound: false,
    players: [you()],
    localPlayerId: 1,
    peds: [],
    vehicles: [],
    tick: TICK,
    ...parts,
  };
}

/** A profile with the mission `id` under way at its first stage. */
function running(
  id: string,
  actors?: MissionProfile["actors"],
): MissionProfile {
  return {
    ...emptyMissionProfile(),
    run: startMission(missionById(id)!, 1, "test", 0),
    actors,
  };
}

function ped(id: number, x: number, y: number): PedState {
  return {
    id,
    x,
    y,
    facing: 0,
    health: 100,
    mode: "walk",
    modeUntilTick: 0,
    rail: null,
    fleeX: 0,
    fleeY: 0,
  };
}

/** A contact's 2D colour as a number. */
function colourOf(css: string): number {
  return Number.parseInt(css.slice(1), 16);
}

describe("createMissionMarkers: contacts", () => {
  it("stands each contact at its anchor in the look the 2D map draws it in", () => {
    const markers = createMissionMarkers();

    markers.update(sceneOf());

    const [noor, vera] = markers.contacts;
    expect(markers.contacts).toHaveLength(2);
    expect([noor!.x, noor!.y]).toEqual(missionAnchor(NOOR!.id));
    expect(noor!.look).toBe(pedLookOf(NOOR!.look));
    expect(noor!.key).toBe(0);
    expect(vera!.key).toBe(2);
    expect(vera!.look).toBe(pedLookOf(VERA!.look));
  });

  it("lights a contact's beacon in its 2D colour while a job of theirs is open", () => {
    const markers = createMissionMarkers();

    markers.update(sceneOf());

    const [noor] = markers.beacons;
    expect([noor!.x, noor!.y]).toEqual(missionAnchor(NOOR!.id));
    expect(noor!.colour).toBe(colourOf(NOOR!.colour));
  });

  it("greys every contact's beacon while you are on a job, as the 2D map does", () => {
    const markers = createMissionMarkers();

    markers.update(sceneOf({ players: [you(running("M01"))] }));

    expect(markers.beacons.slice(0, 2).map((spot) => spot.colour)).toEqual([
      CONTACT_UNAVAILABLE_COLOUR,
      CONTACT_UNAVAILABLE_COLOUR,
    ]);
  });

  it("brings a contact's colour back once a cooldown runs out, at the next refresh", () => {
    const resting = {
      ...emptyMissionProfile(),
      cooldownUntil: { M01: TICK + 5 },
    };
    const markers = createMissionMarkers();
    const player = [you(resting)];
    markers.update(sceneOf({ players: player }));
    expect(markers.beacons[0]!.colour).toBe(CONTACT_UNAVAILABLE_COLOUR);

    markers.update(sceneOf({ players: player, tick: TICK + 6 }));
    expect(markers.beacons[0]!.colour).toBe(CONTACT_UNAVAILABLE_COLOUR);
    const later = TICK + MARKER_REFRESH_TICKS;
    markers.update(sceneOf({ players: player, tick: later }));
    expect(markers.beacons[0]!.colour).toBe(colourOf(NOOR!.colour));
  });

  it("keeps its spots for a new list of the same contacts, and follows a changed list", () => {
    const markers = createMissionMarkers();
    markers.update(sceneOf());
    const [noor] = markers.contacts;

    markers.update(sceneOf({ missionContacts: [NOOR!, VERA!] }));
    expect(markers.contacts[0]).toBe(noor);
    markers.update(sceneOf({ missionContacts: [VERA!] }));

    expect(markers.contacts.map((contact) => contact.key)).toEqual([2]);
    expect(markers.beacons).toHaveLength(1);
  });

  it("stands no one without contacts in the scene", () => {
    const markers = createMissionMarkers();

    markers.update(sceneOf({ missionContacts: undefined }));

    expect(markers.contacts).toHaveLength(0);
    expect(markers.beacons).toHaveLength(0);
  });
});

describe("createMissionMarkers: objectives", () => {
  it("raises a yellow beacon over your current objective", () => {
    const markers = createMissionMarkers();

    markers.update(sceneOf({ players: [you(running("M01"))] }));

    const objective = markers.beacons[2]!;
    expect(markers.beacons).toHaveLength(3);
    expect([objective.x, objective.y]).toEqual(missionAnchor("M01:parcel"));
    expect(objective.colour).toBe(OBJECTIVE_COLOUR);
  });

  it("follows a person the objective is bound to every frame, between refreshes", () => {
    const binding = {
      id: 77,
      routeIndex: 0,
      path: [],
      nextShot: 0,
      vehicleId: null,
    };
    const profile = running("M10", { uitkijk: binding });
    const markers = createMissionMarkers();
    const players = [you(profile)];
    markers.update(sceneOf({ players, peds: [ped(77, 40, 50)] }));
    const objective = markers.beacons[2]!;
    expect([objective.x, objective.y]).toEqual([40, 50]);

    markers.update(
      sceneOf({ players, peds: [ped(77, 44, 53)], tick: TICK + 1 }),
    );

    expect(markers.beacons[2]).toBe(objective);
    expect([objective.x, objective.y]).toEqual([44, 53]);
  });

  it("works nothing out again while only the run's clock moves on, but does for a new stage", () => {
    const markers = createMissionMarkers();
    const profile = running("M01");
    markers.update(sceneOf({ players: [you(profile)] }));
    const beacons = markers.beacons;

    // The simulation hands over a fresh profile every tick while a job runs.
    const ticked = { ...profile, run: { ...profile.run!, lastTick: 1 } };
    markers.update(sceneOf({ players: [you(ticked)], tick: TICK + 1 }));
    expect(markers.beacons).toBe(beacons);

    const staged = { ...ticked, run: { ...ticked.run!, stage: 1 } };
    markers.update(sceneOf({ players: [you(staged)], tick: TICK + 2 }));
    expect(markers.beacons).not.toBe(beacons);
  });

  it("drops the objective's beacon when the job is over", () => {
    const markers = createMissionMarkers();
    markers.update(sceneOf({ players: [you(running("M01"))] }));

    markers.update(sceneOf({ players: [you(emptyMissionProfile())] }));

    expect(markers.beacons).toHaveLength(2);
  });
});
