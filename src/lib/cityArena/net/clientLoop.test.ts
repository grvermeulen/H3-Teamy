import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
import { createCollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState, stepArena, type ArenaWorld } from "../sim/arena";
import { playerById } from "../sim/players";
import { createRng } from "../sim/rng";
import { createInput, type ArenaInputs, type ArenaState } from "../sim/types";
import { createMemoryHub, createMemoryTransport } from "./memoryTransport";
import {
  CLIENT_TICK_HZ,
  RECONCILE_BLEND_MS,
  SNAP_DISTANCE_M,
  createClientLoop,
} from "./clientLoop";
import { emptyTally } from "./scoreboard";
import { encodeSnapshot } from "./snapshotWire";
import { decodeInput, type InputFrame } from "./wire";
import { predictLocal } from "./predictLocal";

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
const ROOM = "ABC234";
const STEP_MS = 1000 / CLIENT_TICK_HZ;
const STEP_S = 1 / CLIENT_TICK_HZ;

describe("local prediction authority boundary", () => {
  it.each([false, true])(
    "matches host movement for an isolated %s driving state",
    (driving) => {
      const initial = boot(42);
      const car = {
        ...initial.vehicles[0]!,
        x: 600,
        y: 100,
        vx: 0,
        vy: 0,
        heading: 0,
      };
      const player = {
        ...initial.players[0]!,
        x: 600,
        y: 100,
        vehicleId: driving ? car.id : null,
        boardingTicksLeft: 0,
      };
      const base = {
        ...initial,
        players: [player],
        vehicles: driving ? [car] : [],
        peds: [],
        cops: [],
        traffic: [],
        pickups: [],
        bullets: [],
      };
      let predicted = base,
        actual = base;
      const input = createInput({ move: [1, 0], aim: 0 });
      for (let i = 0; i < 30; i++) {
        predicted = predictLocal(
          predicted,
          new Map([[player.id, input]]),
          STEP_S,
          world,
          createRng(i),
        );
        actual = stepArena(
          actual,
          new Map([[player.id, input]]),
          STEP_S,
          world,
          createRng(i),
        );
        expect(predicted.players[0]!.x).toBeCloseTo(actual.players[0]!.x, 5);
        expect(predicted.players[0]!.y).toBeCloseTo(actual.players[0]!.y, 5);
      }
    },
  );
  it("leaves combat and unrelated entities authoritative while supplying immediate shot feedback", () => {
    const state = boot(42);
    const events: ArenaState["events"] = [];
    const loop = createClientLoop({
      transport: createMemoryTransport(createMemoryHub(), "me"),
      roomCode: ROOM,
      world,
      playerId: 0,
      state,
      random: createRng(9),
      serverTimeMs: () => 0,
      onTick: (next) => events.push(...next.events),
    });
    loop.setInput(createInput({ fire: true, aim: 0 }));
    for (let i = 0; i < 30; i++) loop.advance(STEP_MS);
    expect(events.filter((event) => event.kind === "shot")).toHaveLength(3);
    expect(loop.state().players[0]!.ammo).toEqual(state.players[0]!.ammo);
    expect(loop.state().players[0]!.health).toBe(state.players[0]!.health);
    expect(loop.state().vehicles).toBe(state.vehicles);
    expect(loop.state().peds).toBe(state.peds);
    expect(loop.state().bullets).toBe(state.bullets);
    loop.stop();
  });
});

/** A booted state. */
function boot(seed = 1): ArenaState {
  return createArenaState({ index, graph, seed, zone }, createRng(seed));
}

/** A client on a fresh hub, plus the pieces a test pokes at. */
function clientOnHub(seed = 1, serverTimeMs: () => number = () => 0) {
  const hub = createMemoryHub();
  const transport = createMemoryTransport(hub, "me");
  const sent: InputFrame[] = [];
  const listener = createMemoryTransport(hub, "host");
  listener
    .channel(`arena:room:${ROOM}:inputs`)
    .subscribe("input", (message) => {
      sent.push(message.data as InputFrame);
    });
  const loop = createClientLoop({
    transport,
    roomCode: ROOM,
    world,
    playerId: 0,
    state: boot(seed),
    random: createRng(seed + 1),
    serverTimeMs,
  });
  return { hub, loop, sent };
}

/** Steps a host-side state with one player's input, as the host would. */
function hostStep(
  state: ArenaState,
  input: ReturnType<typeof createInput>,
  ticks: number,
  seed = 2,
): ArenaState {
  const random = createRng(seed);
  let current = state;
  for (let tick = 0; tick < ticks; tick += 1) {
    const inputs: ArenaInputs = new Map([[0, input]]);
    current = stepArena(current, inputs, STEP_S, world, random);
  }
  return current;
}

describe("clientLoop prediction", () => {
  it("heartbeats idle input at 2 Hz and releases held motion immediately", () => {
    const { hub, loop, sent } = clientOnHub();
    for (let tick = 0; tick < 300; tick++) {
      loop.advance(STEP_MS);
      hub.flush();
    }
    expect(sent.length).toBe(20);
    loop.setInput(createInput({ move: [1, 0], enter: true }));
    loop.advance(STEP_MS);
    hub.flush();
    loop.releaseInput();
    hub.flush();
    expect(decodeInput(sent.at(-1)!).input.move).toEqual([0, 0]);
    expect(decodeInput(sent.at(-1)!).input.enter).toBe(false);
  });
  it("moves my player before any snapshot arrives", () => {
    const { loop } = clientOnHub();
    const before = playerById(loop.state(), 0)!.x;
    loop.setInput(createInput({ move: [1, 0] }));
    for (let tick = 0; tick < 10; tick += 1) loop.advance(STEP_MS);
    expect(playerById(loop.state(), 0)!.x).toBeGreaterThan(before);
  });

  it("predicts at 30 Hz while publishing active input at 15 Hz", () => {
    const { hub, loop, sent } = clientOnHub();
    loop.setInput(createInput({ move: [1, 0] }));
    for (let tick = 0; tick < 5; tick += 1) {
      loop.advance(STEP_MS);
      hub.flush();
    }
    expect(sent).toHaveLength(3);
    expect(sent.map((frame) => frame[0])).toEqual([1, 3, 5]);
    expect(decodeInput(sent[0]!).input.move[0]).toBeCloseTo(1, 2);
  });

  it("predicts at the host's rate, so a replayed tick matches a hosted one", () => {
    const { loop } = clientOnHub(3);
    loop.setInput(createInput({ move: [1, 0] }));
    for (let tick = 0; tick < CLIENT_TICK_HZ; tick += 1) loop.advance(STEP_MS);
    expect(loop.state().tick).toBe(CLIENT_TICK_HZ);
  });
});

describe("clientLoop step fraction", () => {
  it("reports the part of a tick predicted time has reached but not stepped", () => {
    const { loop } = clientOnHub();
    const tickMs = 1000 / CLIENT_TICK_HZ;
    // What the renderer blends by, so the local player and their car move at the display's rate
    // rather than in 30 Hz jumps (`render/smoothing.ts`).
    expect(loop.stepFraction()).toBe(0);
    loop.advance(tickMs / 4);
    expect(loop.stepFraction()).toBeCloseTo(0.25, 6);
    loop.advance(tickMs);
    expect(loop.state().tick).toBe(1);
    expect(loop.stepFraction()).toBeCloseTo(0.25, 6);
  });
});

describe("clientLoop reconciliation", () => {
  it("adopts the host's view of my player", () => {
    const { loop } = clientOnHub(4);
    const host: ArenaState = {
      ...boot(4),
      players: [{ ...boot(4).players[0]!, x: 42, health: 55 }],
    };
    loop.onSnapshot(encodeSnapshot(host, 0, { 0: 0 }));
    const mine = playerById(loop.state(), 0)!;
    expect(mine.x).toBeCloseTo(42, 1);
    expect(mine.health).toBe(55);
  });

  it("replays inputs the host had not seen, landing where local prediction did", () => {
    const seed = 5;
    const { loop } = clientOnHub(seed);
    const input = createInput({ move: [1, 0] });
    loop.setInput(input);
    for (let tick = 0; tick < 10; tick += 1) loop.advance(STEP_MS);
    const predictedX = playerById(loop.state(), 0)!.x;

    // The host is still at tick 0 and has acknowledged nothing, so all ten replay.
    loop.onSnapshot(encodeSnapshot(boot(seed), 0, { 0: 0 }));
    expect(playerById(loop.state(), 0)!.x).toBeCloseTo(predictedX, 1);
  });

  it("does not replay an input the host has already applied", () => {
    const seed = 6;
    const { loop } = clientOnHub(seed);
    loop.setInput(createInput({ move: [1, 0] }));
    for (let tick = 0; tick < 10; tick += 1) loop.advance(STEP_MS);

    const acknowledgedAll = hostStep(
      boot(seed),
      createInput({ move: [1, 0] }),
      10,
    );
    loop.onSnapshot(encodeSnapshot(acknowledgedAll, 0, { 0: 10 }));
    expect(playerById(loop.state(), 0)!.x).toBeCloseTo(
      playerById(acknowledgedAll, 0)!.x,
      1,
    );
  });

  it("blends a small disagreement away rather than snapping", () => {
    const seed = 7;
    const { loop } = clientOnHub(seed);
    loop.setInput(createInput({ move: [1, 0] }));
    for (let tick = 0; tick < 10; tick += 1) loop.advance(STEP_MS);
    const drawnBefore = playerById(loop.view(), 0)!.x;

    const nudged = boot(seed);
    const host: ArenaState = {
      ...nudged,
      players: [
        { ...nudged.players[0]!, x: playerById(loop.state(), 0)!.x - 1 },
      ],
    };
    loop.onSnapshot(encodeSnapshot(host, 0, { 0: 10 }));

    // Drawn position still sits near where it was; the simulation has already moved.
    expect(playerById(loop.view(), 0)!.x).toBeCloseTo(drawnBefore, 0);
    expect(playerById(loop.view(), 0)!.x).not.toBeCloseTo(
      playerById(loop.state(), 0)!.x,
      5,
    );
  });

  it("closes the blend within its window", () => {
    const seed = 8;
    const { loop } = clientOnHub(seed);
    loop.setInput(createInput({ move: [1, 0] }));
    for (let tick = 0; tick < 10; tick += 1) loop.advance(STEP_MS);
    const host: ArenaState = {
      ...boot(seed),
      players: [
        { ...boot(seed).players[0]!, x: playerById(loop.state(), 0)!.x - 1 },
      ],
    };
    loop.onSnapshot(encodeSnapshot(host, 0, { 0: 10 }));
    loop.setInput(createInput({}));
    loop.advance(RECONCILE_BLEND_MS);
    expect(playerById(loop.view(), 0)!.x).toBeCloseTo(
      playerById(loop.state(), 0)!.x,
      5,
    );
  });

  it("snaps rather than blending when the disagreement is large", () => {
    const seed = 9;
    const { loop } = clientOnHub(seed);
    loop.setInput(createInput({ move: [1, 0] }));
    for (let tick = 0; tick < 10; tick += 1) loop.advance(STEP_MS);
    const far = boot(seed);
    const host: ArenaState = {
      ...far,
      players: [
        {
          ...far.players[0]!,
          x: playerById(loop.state(), 0)!.x + SNAP_DISTANCE_M * 4,
        },
      ],
    };
    loop.onSnapshot(encodeSnapshot(host, 0, { 0: 10 }));
    expect(playerById(loop.view(), 0)!.x).toBeCloseTo(
      playerById(loop.state(), 0)!.x,
      5,
    );
  });

  it("takes snapshots straight off the room channel", () => {
    const seed = 10;
    const hub = createMemoryHub();
    const transport = createMemoryTransport(hub, "me");
    const host = createMemoryTransport(hub, "host");
    const loop = createClientLoop({
      transport,
      roomCode: ROOM,
      world,
      playerId: 0,
      state: boot(seed),
      random: createRng(seed),
      serverTimeMs: () => 0,
    });
    const moved: ArenaState = {
      ...boot(seed),
      players: [{ ...boot(seed).players[0]!, x: 77 }],
    };
    void host
      .channel(`arena:room:${ROOM}`)
      .publish("state", encodeSnapshot(moved, 0, { 0: 0 }));
    hub.flush();
    expect(playerById(loop.state(), 0)!.x).toBeCloseTo(77, 1);
    loop.stop();
  });
});

describe("clientLoop view", () => {
  it("draws remote players behind server time, between two snapshots", () => {
    let now = 0;
    const { loop } = clientOnHub(11, () => now);
    const base = boot(11);
    const twoPlayers: ArenaState = {
      ...base,
      players: [base.players[0]!, { ...base.players[0]!, id: 1, x: 0 }],
    };
    loop.onSnapshot(encodeSnapshot(twoPlayers, 1000, { 0: 0 }));
    const later: ArenaState = {
      ...twoPlayers,
      tick: twoPlayers.tick + 3,
      players: [twoPlayers.players[0]!, { ...twoPlayers.players[1]!, x: 10 }],
    };
    loop.onSnapshot(encodeSnapshot(later, 1100, { 0: 0 }));

    // Drawing at 1170 − 120 = 1050 puts the remote player halfway between the two frames.
    now = 1170;
    expect(playerById(loop.view(), 1)!.x).toBeCloseTo(5, 1);
  });

  it("leaves my own player to prediction rather than interpolation", () => {
    let now = 0;
    const { loop } = clientOnHub(12, () => now);
    loop.setInput(createInput({ move: [1, 0] }));
    for (let tick = 0; tick < 10; tick += 1) loop.advance(STEP_MS);

    // A host that agrees with the prediction, so nothing is being blended and the only thing
    // that could move the drawn position is interpolation — which must not touch my own player.
    const agreed = boot(12);
    const host: ArenaState = {
      ...agreed,
      players: [{ ...agreed.players[0]!, x: playerById(loop.state(), 0)!.x }],
    };
    loop.onSnapshot(encodeSnapshot(host, 1000, { 0: 10 }));
    loop.onSnapshot(encodeSnapshot(host, 1100, { 0: 10 }));
    now = 1170;
    expect(playerById(loop.view(), 0)!.x).toBeCloseTo(
      playerById(loop.state(), 0)!.x,
      1,
    );
  });

  it("stops predicting and publishing once stopped", () => {
    const { hub, loop, sent } = clientOnHub(13);
    loop.stop();
    loop.setInput(createInput({ move: [1, 0] }));
    for (let tick = 0; tick < 10; tick += 1) {
      loop.advance(STEP_MS);
      hub.flush();
    }
    expect(sent).toHaveLength(0);
    expect(loop.state().tick).toBe(0);
  });
});

describe("clientLoop error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops unreadable snapshots without reporting hostile payloads to Sentry", () => {
    const hub = createMemoryHub();
    const transport = createMemoryTransport(hub, "me");
    const host = createMemoryTransport(hub, "host");
    const loop = createClientLoop({
      transport,
      roomCode: ROOM,
      world,
      playerId: 0,
      state: boot(20),
      random: createRng(20),
      serverTimeMs: () => 0,
    });
    void host.channel(`arena:room:${ROOM}`).publish("state", "kapot");
    hub.flush();
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    // Still alive: a predicted tick advances it as before.
    loop.advance(STEP_MS);
    expect(loop.state().tick).toBe(1);
    loop.stop();
  });

  it("reports an input the transport refused, rather than leaving it an unhandled rejection", async () => {
    // This publish runs every predicted tick; a transport that keeps refusing would otherwise
    // be an unhandled rejection thirty times a second and nothing in Sentry.
    const hub = createMemoryHub();
    const real = createMemoryTransport(hub, "me");
    const refusing: typeof real = {
      ...real,
      channel(name) {
        const channel = real.channel(name);
        if (!name.endsWith(":inputs")) return channel;
        return {
          ...channel,
          publish: async () => {
            throw new Error("refused");
          },
        };
      },
    };
    const loop = createClientLoop({
      transport: refusing,
      roomCode: ROOM,
      world,
      playerId: 0,
      state: boot(22),
      random: createRng(22),
      serverTimeMs: () => 0,
    });
    loop.advance(STEP_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "client-input" },
      }),
    );
    expect(loop.state().tick).toBe(1);
    loop.stop();
  });
});

describe("clientLoop match phase", () => {
  it("knows nothing about the potje until a snapshot says, then follows it", () => {
    const { loop } = clientOnHub(31);
    expect(loop.match()).toBeNull();
    loop.onSnapshot(
      encodeSnapshot(
        boot(31),
        0,
        {},
        {
          seats: new Map([["me", 0]]),
          tally: emptyTally(),
          match: { phase: "playing", since: 90 },
        },
      ),
    );
    expect(loop.match()).toEqual({ phase: "playing", since: 90 });
    loop.stop();
  });
});

describe("clientLoop host filter", () => {
  it("applies snapshots from the elected host and nobody else", () => {
    const hub = createMemoryHub();
    const loop = createClientLoop({
      transport: createMemoryTransport(hub, "me"),
      roomCode: ROOM,
      world,
      playerId: 0,
      state: boot(41),
      random: createRng(41),
      serverTimeMs: () => 0,
      hostClientId: "host",
    });
    const snapshot = encodeSnapshot({ ...boot(41), tick: 99 }, 0, {});
    void createMemoryTransport(hub, "impostor")
      .channel(`arena:room:${ROOM}`)
      .publish("state", snapshot);
    hub.flush();
    expect(loop.state().tick).toBe(0);
    void createMemoryTransport(hub, "host")
      .channel(`arena:room:${ROOM}`)
      .publish("state", snapshot);
    hub.flush();
    expect(loop.state().tick).toBe(99);
    loop.stop();
  });
});
