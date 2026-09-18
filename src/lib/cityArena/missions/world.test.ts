import { describe, expect, it } from "vitest";
import map from "../../../../public/arena/map/v3/index.json";
import { parseMapIndex } from "../schemas";
import { createArenaPlayer } from "../sim/roster";
import { createInput, type ArenaState } from "../sim/types";
import { encodeInput, decodeInput } from "../net/wire";
import { encodeSnapshot, decodeSnapshot } from "../net/snapshotWire";
import { applySnapshot } from "../net/snapshotApply";
import { isInputFrame, isSnapshot } from "../net/wireValidation";
import { MISDELIVERED_PARCEL, missionById } from "./catalog";
import { startMission } from "./runner";
import { createVehicle } from "../sim/vehicle";
import {
  handleMissionInput,
  missionAnchor,
  missionTargets,
  stepWorldMissions,
  emptyMissionProfile,
  missionUnavailable,
} from "./world";
import { missionHud } from "./hud";
import type { MissionCommand } from "./types";
import { ensureMissionActors } from "./actors";
import { createCollisionGrid } from "../world/collisionGrid";
import { decodeRoadGraph } from "../world/roadGraph";

const index = parseMapIndex(map);
it("makes room for a mission vehicle when ambient vehicles fill the entity budget", () => {
  const state = initial();
  const player = state.players[0];
  const mission = missionById("M04")!;
  player.mission = {
    ...emptyMissionProfile(),
    run: startMission(mission, player.id, "race", 0),
  };
  state.vehicles = Array.from({ length: 160 }, (_, i) =>
    createVehicle(i + 10, "compact", [i * 10, 0], 0, 0),
  );
  player.vehicleId = 169;
  const next = ensureMissionActors(state, world);
  const actors = Object.values(next.players[0].mission!.actors!);
  expect(actors.length).toBeGreaterThan(0);
  expect(next.vehicles).toHaveLength(160);
  expect(next.vehicles.some((vehicle) => vehicle.id === actors[0].id)).toBe(
    true,
  );
  expect(next.vehicles.some((vehicle) => vehicle.id === 169)).toBe(true);
});
it("refuses a contract that cannot fit the round with its thirty-second margin", () => {
  const profile = emptyMissionProfile();
  const needed = (MISDELIVERED_PARCEL.estimatedSeconds + 30) * 30;
  expect(
    missionUnavailable(MISDELIVERED_PARCEL, profile, 0, true, needed - 1),
  ).toBe("Te weinig speeltijd over voor deze missie.");
  expect(
    missionUnavailable(MISDELIVERED_PARCEL, profile, 0, true, needed),
  ).toBeNull();
});
const world = {
  index,
  collision: createCollisionGrid(16),
  graph: decodeRoadGraph({
    nodes: [0, 0, 400, 0],
    edges: [0, 1, 0, -1, 0, 400],
    classes: ["residential"],
    names: [],
  }),
};

function initial(): ArenaState {
  return {
    tick: 0,
    seed: 42,
    nextId: 1000,
    players: [createArenaPlayer(missionAnchor("noor")!, 0)],
    vehicles: [],
    bullets: [],
    effects: [],
    peds: [],
    cops: [],
    pickups: [],
    traffic: [],
    events: [],
    zoneKey: "rhenen",
    activeZoneKey: "rhenen",
    enforcedZoneKey: null,
    zoneEnforced: false,
  };
}

function command(state: ArenaState, action: MissionCommand): ArenaState {
  const frame = encodeInput(
    action.sequence,
    createInput({ missionCommand: action }),
  );
  expect(isInputFrame(frame)).toBe(true);
  return handleMissionInput(
    state,
    state.players[0],
    decodeInput(frame).input,
    false,
    index,
  ).state;
}

function accepted(): ArenaState {
  let state = command(initial(), {
    sequence: 1,
    kind: "offer",
    missionId: "M01",
  });
  expect(missionHud(index, state, state.players[0]).offer?.id).toBe("M01");
  state = command(state, { sequence: 2, kind: "accept", missionId: "M01" });
  expect(state.players[0].mission?.run?.status).toBe("active");
  return state;
}

function visit(state: ArenaState, target: string, enter: boolean): ArenaState {
  state = ensureMissionActors(state, world);
  const point = missionTargets(MISDELIVERED_PARCEL)[target].position;
  const input = createInput({ enter });
  const next = {
    ...state,
    tick: state.tick + 1,
    players: [
      {
        ...state.players[0],
        x: point[0],
        y: point[1],
        held: { enter, weaponNext: false },
      },
    ],
  };
  return stepWorldMissions(
    next,
    state,
    new Map([[state.players[0].id, input]]),
    index,
  );
}

describe("street contract integration", () => {
  it("accepts at the contact, completes the actual parcel itinerary and pays once across host replacement", () => {
    let state = accepted();
    state = visit(state, "parcel", true);
    expect(state.players[0].mission?.run?.stage).toBe(1);
    for (let i = 0; i < 30; i++) state = visit(state, "note", true);
    expect(state.players[0].mission?.run?.stage).toBe(2);
    const packet = encodeSnapshot(state, 1000, {});
    expect(isSnapshot(packet)).toBe(true);
    state = applySnapshot(initial(), decodeSnapshot(packet));
    expect(state.players[0].mission?.run?.inventory).toEqual(["parcel"]);
    state = visit(state, "old-door", false);
    state = visit(state, "neighbour", true);
    state = visit(state, "recipient", false);
    state = visit(state, "recipient", true);
    expect(state.players[0].mission?.run?.status).toBe("completed");
    expect(state.players[0].mission?.wallet.earned).toBe(325);
    for (let i = 0; i < 10; i++) state = visit(state, "recipient", true);
    expect(state.players[0].mission?.wallet.receipts).toHaveLength(1);
    expect(state.players[0].mission?.wallet.earned).toBe(325);
  });

  it("rejects remote acceptance and duplicate commands without resetting progress", () => {
    const original = accepted();
    const replay = command(original, {
      sequence: 2,
      kind: "accept",
      missionId: "M01",
    });
    expect(replay).toBe(original);
    const far = initial();
    far.players[0].x += 100;
    const rejected = command(far, {
      sequence: 1,
      kind: "offer",
      missionId: "M01",
    });
    expect(rejected.players[0].mission?.offer).toBeNull();
  });

  it("fails on death and keeps the wallet separate from a failed contract", () => {
    const before = accepted();
    const dead = {
      ...before,
      tick: 1,
      players: [{ ...before.players[0], health: 0, diedAtTick: 1 }],
    };
    const state = stepWorldMissions(dead, before, new Map(), index);
    expect(state.players[0].mission?.run?.status).toBe("failed");
    expect(state.players[0].mission?.wallet.earned).toBe(0);
  });

  it("rejects forged mission ownership and out-of-range protocol intents", () => {
    const packet = encodeSnapshot(accepted(), 1, {});
    packet.u![0][1] = {
      ...packet.u![0][1],
      run: { ...packet.u![0][1].run!, ownerId: 999 },
    };
    expect(isSnapshot(packet)).toBe(false);
    expect(isInputFrame([1, 0, 0, -1, 0, 1, 99, 1])).toBe(false);
    expect(isInputFrame([1, 0, 0, -1, 0, 1, 0, 25])).toBe(false);
  });
});
