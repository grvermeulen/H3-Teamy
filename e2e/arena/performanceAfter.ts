import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  createArenaState,
  stepArena,
  addArenaPlayer,
} from "../../src/lib/cityArena/sim/arena";
import { createRng } from "../../src/lib/cityArena/sim/rng";
import { createInput, EMPTY_INPUT } from "../../src/lib/cityArena/sim/types";
import { decodeRoadGraph } from "../../src/lib/cityArena/world/roadGraph";
import { decodeTile } from "../../src/lib/cityArena/world/decode";
import { createCollisionGrid } from "../../src/lib/cityArena/world/collisionGrid";
import { createRoadCorridors } from "../../src/lib/cityArena/world/roadCorridor";
import type {
  MapIndex,
  MapRoads,
  MapTile,
} from "../../src/lib/cityArena/world/mapTypes";
import { predictLocal } from "../../src/lib/cityArena/net/predictLocal";
import { createSnapshotEncoder } from "../../src/lib/cityArena/net/snapshotDelta";
import { encodeSnapshot } from "../../src/lib/cityArena/net/snapshotWire";
import {
  createMemoryHub,
  createMemoryTransport,
} from "../../src/lib/cityArena/net/memoryTransport";
import { createHostLoop } from "../../src/lib/cityArena/net/hostLoop";
import { createClientLoop } from "../../src/lib/cityArena/net/clientLoop";
import { MAP_BASE_PATH } from "../../src/lib/cityArena/constants";

const directory = `public${MAP_BASE_PATH}`;
const read = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
const index = read<MapIndex>("index.json");
const graph = decodeRoadGraph(read<MapRoads>("roads.json"));
const collision = createCollisionGrid();
collision.setRoadCorridors(createRoadCorridors(graph));
for (const file of fs
  .readdirSync(directory)
  .filter((file) => file.startsWith("tile_")))
  collision.insertTile(decodeTile(read<MapTile>(file), index));
const world = { index, graph, collision };
const percentile = (samples: number[], p: number) =>
  [...samples].sort((a, b) => a - b)[
    Math.min(samples.length - 1, Math.floor(samples.length * p))
  ]!;
const summary = (samples: number[]) => ({
  p50: percentile(samples, 0.5),
  p95: percentile(samples, 0.95),
  p99: percentile(samples, 0.99),
  max: Math.max(...samples),
});
const sizes = (data: unknown) => Buffer.byteLength(JSON.stringify(data));
const scenarios: object[] = [];
for (const zone of index.zones) {
  const random = createRng(42);
  let state = createArenaState({ index, graph, seed: 42, zone }, random);
  while (state.players.length < 8)
    state = addArenaPlayer(state, world, state.tick, random).state;
  const fullSim: number[] = [],
    local: number[] = [],
    wholeReplay: number[] = [],
    fullBytes: number[] = [],
    reducedBytes: number[] = [];
  const compress = createSnapshotEncoder();
  for (let tick = 0; tick < 2100; tick++) {
    const input = createInput({
      move: [Math.cos(tick / 90), Math.sin(tick / 90)],
      aim: tick / 90,
      fire: tick % 3 === 0,
    });
    const inputs = new Map(state.players.map((p) => [p.id, input]));
    const own = new Map([[state.players[0]!.id, input]]);
    let before = performance.now();
    predictLocal(state, own, 1 / 30, world, createRng(tick));
    const localMs = performance.now() - before;
    before = performance.now();
    stepArena(state, own, 1 / 30, world, createRng(tick));
    const replayMs = performance.now() - before;
    before = performance.now();
    state = stepArena(state, inputs, 1 / 30, world, random);
    if (tick >= 300) {
      fullSim.push(performance.now() - before);
      local.push(localMs);
      wholeReplay.push(replayMs);
    }
    if (tick % 3 === 0) {
      const snapshot = encodeSnapshot(state, (tick * 1000) / 30, {});
      const reduced = compress(snapshot);
      if (tick >= 300) {
        fullBytes.push(sizes(snapshot));
        reducedBytes.push(sizes(reduced));
      }
    }
  }
  const totalFull = fullBytes.reduce((a, b) => a + b, 0),
    totalReduced = reducedBytes.reduce((a, b) => a + b, 0);
  scenarios.push({
    zone: zone.key,
    players: 8,
    measuredSeconds: 60,
    hostStepMs: summary(fullSim),
    previousWholeWorldReplayMs: summary(wholeReplay),
    localPredictionMs: summary(local),
    fullSnapshotBytes: summary(fullBytes),
    reducedSnapshotBytes: summary(reducedBytes),
    totalFull,
    totalReduced,
    bandwidthReductionPercent: 100 * (1 - totalReduced / totalFull),
  });
}

// Five minutes of eight-player traffic, with deterministic loss and variable delivery delay.
const hub = createMemoryHub({
  dropRate: 0.1,
  latencyFlushes: 3,
  random: createRng(777),
});
let clock = 0,
  inputCount = 0,
  activeInputs = 0,
  idleInputs = 0,
  maxPending = 0;
const hostTransport = createMemoryTransport(hub, "host");
const host = createHostLoop({
  transport: hostTransport,
  roomCode: "ABC234",
  world,
  state: createArenaState(
    { index, graph, seed: 3, zone: index.zones[0] },
    createRng(3),
  ),
  random: createRng(4),
  serverTimeMs: () => clock,
});
host.claim("host", 0);
const clients = Array.from({ length: 7 }, (_, i) => {
  const id = `peer-${i}`,
    playerId = host.addMember(id)!;
  const real = createMemoryTransport(hub, id);
  const transport: typeof real = {
    ...real,
    channel(name) {
      const channel = real.channel(name);
      return {
        ...channel,
        publish: async (kind, data) => {
          if (kind === "input") {
            inputCount++;
            if (clock < 240000) activeInputs++;
            else idleInputs++;
          }
          return channel.publish(kind, data);
        },
      };
    },
  };
  return {
    playerId,
    loop: createClientLoop({
      transport,
      roomCode: "ABC234",
      playerId,
      world,
      state: host.state(),
      random: createRng(100 + i),
      serverTimeMs: () => clock,
    }),
  };
});
const beforeStress = performance.now();
for (let tick = 0; tick < 9000; tick++) {
  clock = (tick * 1000) / 30;
  hub.internals.latencyFlushes = tick % 60 < 30 ? 1 : 5;
  for (const { loop } of clients) {
    loop.setInput(
      tick < 7200
        ? createInput({
            move: [Math.cos(tick / 75), Math.sin(tick / 75)],
            aim: tick / 75,
          })
        : EMPTY_INPUT,
    );
    loop.advance(1000 / 30);
  }
  host.advance(1000 / 30);
  hub.flush();
  maxPending = Math.max(maxPending, hub.pending());
  assert.equal(host.isPublishing(), true);
}
const errors = clients.map(({ playerId, loop }) => {
  const actual = host.state().players.find((p) => p.id === playerId)!;
  const predicted = loop.state().players.find((p) => p.id === playerId)!;
  assert.ok(Number.isFinite(predicted.x) && Number.isFinite(predicted.y));
  return Math.hypot(actual.x - predicted.x, actual.y - predicted.y);
});
assert.ok(
  Math.max(...errors) < 0.5,
  `Idle convergence error ${Math.max(...errors)}m`,
);
for (const { loop } of clients) loop.stop();
host.stop();
const output = {
  environment: {
    node: process.version,
    platform: process.platform,
    cpuTiming:
      "Paired measurement within this run; baseline audit used Node 24. No browser GPU or physical device benchmark.",
    map: "all production tiles loaded",
  },
  scenarios,
  stress: {
    seconds: 300,
    players: 8,
    dropRate: 0.1,
    latencyMs: [33, 167],
    elapsedWallSeconds: (performance.now() - beforeStress) / 1000,
    inputCount,
    activeInputsPerClientHz: activeInputs / 7 / 240,
    idleInputsPerClientHz: idleInputs / 7 / 60,
    maxQueuedMessages: maxPending,
    finalPositionErrorsMetres: errors,
    hostPublishing: true,
  },
};
fs.writeFileSync(
  process.argv[2] ?? "docs/tech/arena/audits/2026-09-12/performance-after.json",
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify(output));
