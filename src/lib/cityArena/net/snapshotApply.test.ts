import { describe, expect, it } from "vitest";
import { createCollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState, stepArena, type ArenaWorld } from "../sim/arena";
import { checkInvariants } from "../sim/invariants";
import { createRng } from "../sim/rng";
import { createInput, type ArenaInputs, type ArenaState } from "../sim/types";
import { applySnapshot } from "./snapshotApply";
import { decodeSnapshot, encodeSnapshot } from "./snapshotWire";

const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [600, 0],
  radius: 2000,
  spawnNodes: [
    [0, 0],
    [400, 0],
    [800, 0],
    [1200, 0],
  ],
  landmarks: [],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [zone],
  landmarks: [],
};
const graph = decodeRoadGraph({
  nodes: [0, 0, 1200, 0],
  edges: [0, 1, 0, -1, 0, 1200],
  classes: ["residential"],
  names: [],
});
const world: ArenaWorld = { collision: createCollisionGrid(), index, graph };
const STEP_S = 1 / 30;

/** A booted state. */
function boot(seed = 1): ArenaState {
  return createArenaState({ index, graph, seed, zone }, createRng(seed));
}

/** Steps `state` for `ticks` with everyone walking east. */
function run(state: ArenaState, ticks: number, seed = 9): ArenaState {
  const random = createRng(seed);
  let current = state;
  for (let tick = 0; tick < ticks; tick += 1) {
    const inputs: ArenaInputs = new Map(
      current.players.map((player) => [
        player.id,
        createInput({ move: [1, 0], fire: tick % 15 === 0 }),
      ]),
    );
    current = stepArena(current, inputs, STEP_S, world, random);
  }
  return current;
}

/** The host's world, folded into a client that started from the same seed. */
function fold(host: ArenaState, client: ArenaState): ArenaState {
  return applySnapshot(client, decodeSnapshot(encodeSnapshot(host, 0, {})));
}

describe("applySnapshot", () => {
  it("brings the client to the host's tick and player positions", () => {
    const host = run(boot(), 60);
    const folded = fold(host, boot());
    expect(folded.tick).toBe(host.tick);
    expect(folded.players[0]!.x).toBeCloseTo(host.players[0]!.x, 1);
    expect(folded.players[0]!.health).toBe(host.players[0]!.health);
  });

  it("produces a state the invariant checker accepts", () => {
    const host = run(boot(2), 120);
    expect(checkInvariants(fold(host, boot(2)))).toEqual([]);
  });

  it("produces a state that can be stepped straight on", () => {
    const host = run(boot(3), 90);
    let folded = fold(host, boot(3));
    const violations: string[] = [];
    for (let tick = 0; tick < 30; tick += 1) {
      folded = stepArena(folded, new Map(), STEP_S, world, createRng(5));
      violations.push(...checkInvariants(folded));
    }
    expect(violations).toEqual([]);
  });

  it("keeps local-only fields the snapshot does not carry", () => {
    const client = run(boot(4), 30);
    const host = run(boot(4), 60);
    const before = client.peds[0];
    expect(before).toBeDefined();
    const folded = fold(host, client);
    const after = folded.peds.find((ped) => ped.id === before!.id);
    expect(after).toBeDefined();
    expect(after!.rail).toEqual(before!.rail);
    expect(folded.players[0]!.held).toEqual(client.players[0]!.held);
  });

  it("adopts players the client has never seen", () => {
    const host = run(boot(5), 10);
    const twoPlayers: ArenaState = {
      ...host,
      players: [host.players[0]!, { ...host.players[0]!, id: 7, x: 20 }],
    };
    const folded = fold(twoPlayers, boot(5));
    expect(folded.players.map((player) => player.id)).toEqual([0, 7]);
  });

  it("drops a player the host has dropped", () => {
    const client = run(boot(6), 10);
    const withGuest: ArenaState = {
      ...client,
      players: [client.players[0]!, { ...client.players[0]!, id: 7, x: 20 }],
    };
    const folded = fold(client, withGuest);
    expect(folded.players.map((player) => player.id)).toEqual([0]);
  });

  it("keeps nextId above every id it just adopted", () => {
    const host = run(boot(7), 20);
    const withGuest: ArenaState = {
      ...host,
      players: [host.players[0]!, { ...host.players[0]!, id: 999, x: 20 }],
    };
    const folded = fold(withGuest, boot(7));
    expect(folded.nextId).toBeGreaterThan(999);
  });

  it("derives a dead cop's diedAtTick so death and health agree", () => {
    const host = run(boot(8), 60);
    const withDeadCop: ArenaState = {
      ...host,
      cops: [
        {
          id: 500,
          x: 5,
          y: 0,
          facing: 0,
          health: 0,
          weapon: "pistol",
          path: [],
          repathTick: 0,
          nextShotTick: 0,
          diedAtTick: host.tick,
        },
      ],
    };
    const folded = fold(withDeadCop, boot(8));
    expect(folded.cops[0]!.diedAtTick).not.toBeNull();
    expect(checkInvariants(folded)).toEqual([]);
  });

  it("drops an ambient driver whose car the host has wrecked", () => {
    const host = run(boot(9), 40);
    const wrecked: ArenaState = {
      ...host,
      vehicles: host.vehicles.map((vehicle, position) =>
        position === 0 ? { ...vehicle, wrecked: true, health: 0 } : vehicle,
      ),
    };
    const client: ArenaState = {
      ...host,
      traffic: host.vehicles[0]
        ? [
            {
              vehicleId: host.vehicles[0].id,
              role: "civilian",
              path: [],
              repathTick: 0,
              targetSpeedMps: 5,
            },
          ]
        : [],
    };
    const folded = fold(wrecked, client);
    expect(
      folded.traffic.some(
        (driver) => driver.vehicleId === host.vehicles[0]?.id,
      ),
    ).toBe(false);
    expect(checkInvariants(folded)).toEqual([]);
  });
});
