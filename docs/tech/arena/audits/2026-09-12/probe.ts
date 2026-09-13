import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { decodeRoadGraph } from "../../../../../src/lib/cityArena/world/roadGraph";
import { decodeTile } from "../../../../../src/lib/cityArena/world/decode";
import { createCollisionGrid } from "../../../../../src/lib/cityArena/world/collisionGrid";
import { createRoadCorridors } from "../../../../../src/lib/cityArena/world/roadCorridor";
import {
  createArenaState,
  stepArena,
  addArenaPlayer,
} from "../../../../../src/lib/cityArena/sim/arena";
import { createRng } from "../../../../../src/lib/cityArena/sim/rng";
import { createInput } from "../../../../../src/lib/cityArena/sim/types";
import { encodeSnapshot } from "../../../../../src/lib/cityArena/net/snapshotWire";
import { createHostLoop } from "../../../../../src/lib/cityArena/net/hostLoop";
import {
  createMemoryHub,
  createMemoryTransport,
} from "../../../../../src/lib/cityArena/net/memoryTransport";
import {
  electHost,
  actingHost,
} from "../../../../../src/lib/cityArena/net/election";
import { PostMatchSchema } from "../../../../../src/lib/schemas/arena";
import type {
  MapIndex,
  MapRoads,
  MapTile,
} from "../../../../../src/lib/cityArena/world/mapTypes";
import type { PresenceMember } from "../../../../../src/lib/cityArena/net/transport";

async function main() {
  const base = "public/arena/map/v1";
  const read = <T>(file: string): T =>
    JSON.parse(fs.readFileSync(path.join(base, file), "utf8")) as T;
  const index = read<MapIndex>("index.json");
  const graph = decodeRoadGraph(read<MapRoads>("roads.json"));
  const collision = createCollisionGrid();
  collision.setRoadCorridors(createRoadCorridors(graph));
  for (const file of fs.readdirSync(base).filter((f) => f.startsWith("tile_")))
    collision.insertTile(decodeTile(read<MapTile>(file), index));
  const world = { index, graph, collision };
  const percentile = (values: number[], p: number) =>
    [...values].sort((a, b) => a - b)[
      Math.min(values.length - 1, Math.floor(values.length * p))
    ];
  const simulations = [];
  for (const zone of index.zones) {
    for (const players of [1, 8]) {
      const random = createRng(42);
      let state = createArenaState({ index, graph, seed: 42, zone }, random);
      while (state.players.length < players)
        state = addArenaPlayer(state, world, state.tick, random).state;
      const times: number[] = [];
      const sizes: number[] = [];
      for (let tick = 0; tick < 2100; tick++) {
        const inputs = new Map(
          state.players.map((p) => [
            p.id,
            createInput({
              move: [Math.cos(tick / 90), Math.sin(tick / 90)],
              aim: tick / 90,
              fire: tick % 3 === 0,
            }),
          ]),
        );
        const before = performance.now();
        state = stepArena(state, inputs, 1 / 30, world, random);
        if (tick >= 300) times.push(performance.now() - before);
        if (tick >= 300 && tick % 3 === 0)
          sizes.push(
            Buffer.byteLength(
              JSON.stringify(encodeSnapshot(state, (tick * 1000) / 30, {})),
            ),
          );
      }
      simulations.push({
        zone: zone.key,
        players,
        ticks: times.length,
        simP50Ms: percentile(times, 0.5),
        simP95Ms: percentile(times, 0.95),
        simP99Ms: percentile(times, 0.99),
        simMaxMs: Math.max(...times),
        snapshotMedianBytes: percentile(sizes, 0.5),
        snapshotMaxBytes: Math.max(...sizes),
        entities: {
          vehicles: state.vehicles.length,
          peds: state.peds.length,
          cops: state.cops.length,
        },
      });
    }
  }
  const hub = createMemoryHub();
  const hostTransport = createMemoryTransport(hub, "host");
  const hostile = createMemoryTransport(hub, "local-test-client");
  const host = createHostLoop({
    transport: hostTransport,
    roomCode: "AUD234",
    world,
    state: createArenaState(
      { index, graph, seed: 7, zone: index.zones[0] },
      createRng(7),
    ),
    random: createRng(8),
    serverTimeMs: () => 0,
  });
  host.addMember("local-test-client");
  await hostile.channel("arena:room:AUD234:inputs").publish("input", { 0: 1 });
  hub.flush();
  host.advance(200);
  const malformedFrame = {
    publishing: host.isPublishing(),
    tick: host.state().tick,
  };
  host.stop();
  const members: PresenceMember[] = [
    {
      clientId: "legitimate",
      timestamp: 1,
      data: {
        name: "Local A",
        colour: "#ffffff",
        role: "player",
        device: "desktop",
      },
    },
    {
      clientId: "new-display",
      timestamp: 2,
      data: {
        name: "Local B",
        colour: "#ffffff",
        role: "display",
        device: "desktop",
      },
    },
  ];
  const authority = {
    elected: electHost(members),
    acting: actingHost(
      members,
      [
        { clientId: "legitimate", timestamp: 1000 },
        { clientId: "new-display", timestamp: 1000 },
      ],
      1000,
    ),
  };
  const malformedResult = {
    roomCode: "ABC234",
    zone: "rhenen",
    startedAt: "2099-01-01T00:00:00Z",
    endedAt: "2000-01-01T00:00:00Z",
    results: [
      { userId: "same", kills: 200, deaths: 0, won: true },
      { userId: "same", kills: 200, deaths: 0, won: true },
    ],
  };
  const assetFiles = (dir: string): string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory()
          ? assetFiles(path.join(dir, e.name))
          : [path.join(dir, e.name)],
      );
  const assets = assetFiles("public/arena").map((file) => {
    const b = fs.readFileSync(file);
    return {
      file: file.replaceAll("\\", "/"),
      bytes: b.length,
      gzipBytes: gzipSync(b).length,
    };
  });
  const output = {
    environment: {
      node: process.version,
      platform: process.platform,
      cpus: process.env.NUMBER_OF_PROCESSORS,
    },
    scope:
      "Node CPU microbenchmark; actual map, all tiles resident; 300 warmup + 1800 measured ticks; synthetic moving/firing input; no browser or transport timing",
    simulations,
    malformedFrame,
    authority,
    invalidMatchAccepted: PostMatchSchema.safeParse(malformedResult).success,
    assets,
  };
  fs.writeFileSync(
    "docs/tech/arena/audits/2026-09-12/probe-results.json",
    JSON.stringify(output, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...output,
        assets: {
          files: assets.length,
          totalBytes: assets.reduce((s, a) => s + a.bytes, 0),
          mapGzipBytes: assets
            .filter((a) => a.file.includes("/map/") && a.file.endsWith(".json"))
            .reduce((s, a) => s + a.gzipBytes, 0),
          largest: assets.sort((a, b) => b.bytes - a.bytes).slice(0, 8),
        },
      },
      null,
      2,
    ),
  );
}
void main();
