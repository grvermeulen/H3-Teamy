import type { MissionObservation } from "../types";

/** Authoritative observation fixture with a player and explicitly bound mission targets. */
export function observation(
  patch: Partial<MissionObservation> = {},
): MissionObservation {
  return {
    tick: 1,
    playerId: 0,
    position: [0, 0],
    previousPosition: [0, 0],
    teleported: false,
    alive: true,
    speed: 0,
    vehicleId: null,
    wanted: 0,
    interacting: false,
    interacted: false,
    targets: {
      parcel: { id: 101, position: [0, 0], alive: true },
      note: { id: 102, position: [0, 0], alive: true },
      "old-door": { id: 103, position: [100, 0], alive: true },
      neighbour: { id: 104, position: [100, 0], alive: true },
      recipient: { id: 105, position: [200, 0], alive: true },
    },
    kills: [],
    hijackedVehicleIds: [],
    civilianKills: 0,
    minimumIntegrity: 100,
    essentialFailure: null,
    ...patch,
  };
}
