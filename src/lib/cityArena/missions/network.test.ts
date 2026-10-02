import { describe, expect, it } from "vitest";
import map from "../../../../public/arena/map/v3/index.json";
import { parseMapIndex } from "../schemas";
import { createArenaState, createArenaPlayer } from "../sim/arena";
import { createVehicle } from "../sim/vehicle";
import { createRng } from "../sim/rng";
import { decodeRoadGraph } from "../world/roadGraph";
import {
  encodeSnapshot,
  decodeSnapshot,
  snapshotBytes,
} from "../net/snapshotWire";
import {
  createSnapshotDecoder,
  createSnapshotEncoder,
} from "../net/snapshotDelta";
import { isSnapshot, MAX_WIRE_SNAPSHOT_BYTES } from "../net/wireValidation";
import { emptyTally, tallyEvents, rankScoreboard } from "../net/scoreboard";
import { MISSION_CATALOG, missionById } from "./catalog";
import { emptyMissionProfile } from "./world";
import { startMission } from "./runner";

describe("mission takeover snapshots", () => {
  it("fits eight concurrent contracts and preserves all payouts through a full/delta takeover", () => {
    const index = parseMapIndex(map);
    const graph = decodeRoadGraph({
      nodes: [0, 0, 400, 0],
      edges: [0, 1, 0, -1, 0, 400],
      classes: ["residential"],
      names: [],
    });
    const state = createArenaState(
      { index, graph, seed: 1, zone: index.zones[0] },
      createRng(1),
    );
    state.tick = 10_000;
    state.vehicles = Array.from({ length: 160 }, (_, i) =>
      createVehicle(100 + i, "tank", [i * 10, 0], 0, 0),
    );
    state.players = Array.from({ length: 8 }, (_, i) => {
      const mission = emptyMissionProfile();
      const receipts = MISSION_CATALOG.filter(
        (entry) => entry.zone === "bennekom",
      ).map((entry) => ({
        contractId: `${i}:${entry.id}`,
        missionId: entry.id,
        version: 1,
        playerId: i,
        tick: 9000,
        base: entry.basePay,
        bonus: 0,
        total: entry.basePay,
      }));
      mission.wallet = {
        balance: receipts.reduce((sum, r) => sum + r.total, 0),
        earned: receipts.reduce((sum, r) => sum + r.total, 0),
        receipts,
      };
      mission.run = startMission(missionById("M24")!, i, `${i}:current`, 9000);
      mission.actors = Object.fromEntries(
        Array.from({ length: 16 }, (_, a) => [
          `actor-${a}`,
          {
            id: 1000 + i * 16 + a,
            routeIndex: 0,
            nextShot: 10_010,
            vehicleId: null,
            path: Array.from(
              { length: 256 },
              (_, p) => [p * 1.127, p * 2.257] as [number, number],
            ),
          },
        ]),
      );
      return { ...createArenaPlayer([i, 0], 0), id: i, mission };
    });
    const tally = tallyEvents(emptyTally(), [], state.players);
    const full = encodeSnapshot(
      state,
      0,
      {},
      { tally, seats: new Map(), match: { phase: "playing", since: 0 } },
    );
    expect(snapshotBytes(full)).toBeLessThan(MAX_WIRE_SNAPSHOT_BYTES);
    expect(isSnapshot(full)).toBe(true);
    expect(isSnapshot({ ...full, n: 2 })).toBe(false);
    const encoder = createSnapshotEncoder(),
      decoder = createSnapshotDecoder();
    decoder(encoder(full));
    const delta = encoder({ ...full, t: 10_003 });
    const restored = decodeSnapshot(decoder(delta)!);
    expect(restored.vehicles[0].health).toBe(750);
    expect(restored.players[0].mission?.actors?.["actor-0"].path).toEqual([]);
    expect(rankScoreboard(restored.tally, [], 0)).toEqual(
      rankScoreboard(tally, [], 0),
    );
    expect(restored.players.map((player) => player.mission?.wallet)).toEqual(
      state.players.map((player) => player.mission?.wallet),
    );
  });
});
