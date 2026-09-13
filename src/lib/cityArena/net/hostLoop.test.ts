import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState, stepArena, type ArenaWorld } from "../sim/arena";
import { checkInvariants } from "../sim/invariants";
import { playersOf } from "../sim/players";
import { createRng } from "../sim/rng";
import { createInput } from "../sim/types";
import { createMemoryHub, createMemoryTransport } from "./memoryTransport";
import {
  INPUT_HOLD_TICKS,
  HOST_TICK_HZ,
  MAX_CATCHUP_TICKS,
  SNAPSHOT_HZ,
  createHostLoop,
} from "./hostLoop";
import { encodeInput } from "./wire";
import { decodeSnapshot, type Snapshot } from "./snapshotWire";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

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

/** A step that throws for its first `count` calls, then defers to the real one. */
function flakyStep(count: number) {
  let left = count;
  return ((state, inputs, dt, stepWorld, random) => {
    if (left > 0) {
      left -= 1;
      throw new Error("tick failed");
    }
    return stepArena(state, inputs, dt, stepWorld, random);
  }) satisfies typeof stepArena;
}

/** A host on a fresh hub, plus everything a test needs to poke at it. */
function hostOnHub(seed = 1, step?: typeof stepArena) {
  const hub = createMemoryHub();
  const transport = createMemoryTransport(hub, "host");
  const published: { name: string; data: unknown }[] = [];
  const watcher = createMemoryTransport(hub, "watcher");
  watcher.channel(`arena:room:${ROOM}`).subscribe("state", (message) => {
    published.push({ name: "state", data: message.data });
  });
  const loop = createHostLoop({
    transport,
    roomCode: ROOM,
    world,
    state: createArenaState({ index, graph, seed, zone }, createRng(seed)),
    random: createRng(seed + 1),
    serverTimeMs: () => 1000,
    step,
  });
  return { hub, loop, published, transport };
}

/** The snapshots a watcher saw, decoded. */
function snapshots(published: { data: unknown }[]) {
  return published.map((entry) => decodeSnapshot(entry.data as Snapshot));
}

describe("hostLoop stepping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("steps 30 times and publishes 10 snapshots per simulated second", () => {
    const { hub, loop, published } = hostOnHub();
    for (let index = 0; index < 30; index += 1) {
      loop.advance(1000 / HOST_TICK_HZ);
      hub.flush();
    }
    expect(loop.state().tick).toBe(HOST_TICK_HZ);
    expect(published).toHaveLength(SNAPSHOT_HZ);
  });

  it("steps the same number of ticks however the elapsed time is chunked", () => {
    // True only for chunks inside the catch-up cap: ten frames of 100 ms is three ticks each,
    // a hundred of 10 ms is a tick every fourth. Both are a second of simulated time.
    const even = hostOnHub();
    for (let index = 0; index < 10; index += 1) even.loop.advance(100);
    const fine = hostOnHub();
    for (let index = 0; index < 100; index += 1) fine.loop.advance(10);
    expect(even.loop.state().tick).toBe(HOST_TICK_HZ);
    expect(fine.loop.state().tick).toBe(HOST_TICK_HZ);
  });

  it("keeps the leftover of a partial tick rather than dropping it", () => {
    const { loop } = hostOnHub();
    for (let index = 0; index < 3; index += 1) loop.advance(12);
    expect(loop.state().tick).toBe(1);
  });

  it("drops the backlog rather than replaying it when catch-up is capped", () => {
    // A stalled host loses simulated time on purpose; replaying it would freeze the frame, and
    // spec §6.6 covers a host that falls behind by re-electing rather than by catching up.
    const { loop } = hostOnHub();
    loop.advance(60_000);
    loop.advance(1000 / HOST_TICK_HZ);
    expect(loop.state().tick).toBe(MAX_CATCHUP_TICKS + 1);
  });

  it("caps catch-up so a backgrounded tab does not run thousands of ticks", () => {
    const { loop } = hostOnHub();
    loop.advance(60_000);
    expect(loop.state().tick).toBeLessThanOrEqual(MAX_CATCHUP_TICKS);
  });

  it("reports the part of a tick it has taken in but not yet stepped", () => {
    const { loop } = hostOnHub();
    const tickMs = 1000 / HOST_TICK_HZ;
    // The renderer draws this far past the last tick, so a world stepped at 30 Hz still moves at
    // the display's rate (`render/smoothing.ts`).
    expect(loop.stepFraction()).toBe(0);
    loop.advance(tickMs / 4);
    expect(loop.stepFraction()).toBeCloseTo(0.25, 6);
    loop.advance(tickMs / 2);
    expect(loop.stepFraction()).toBeCloseTo(0.75, 6);
    // Crossing a whole tick steps it and leaves the remainder behind, never a fraction above 1.
    loop.advance(tickMs / 2);
    expect(loop.state().tick).toBe(1);
    expect(loop.stepFraction()).toBeCloseTo(0.25, 6);
  });

  it("keeps the step fraction inside 0..1 even when catch-up is capped", () => {
    const { loop } = hostOnHub();
    loop.advance(1000 * 60);
    const fraction = loop.stepFraction();
    expect(fraction).toBeGreaterThanOrEqual(0);
    expect(fraction).toBeLessThanOrEqual(1);
  });

  it("holds the invariants over a hundred ticks", () => {
    const { hub, loop } = hostOnHub(3);
    const violations: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      loop.advance(1000 / HOST_TICK_HZ);
      hub.flush();
      violations.push(...checkInvariants(loop.state()));
    }
    expect(violations).toEqual([]);
  });
});

describe("hostLoop inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies a member's input to the player they were given", () => {
    const { hub, loop, transport } = hostOnHub();
    const member = createMemoryTransport(hub, "bo");
    const playerId = loop.addMember("bo");
    expect(playerId).not.toBeNull();
    const before = playersOf(loop.state()).find(
      (player) => player.id === playerId,
    )!;
    void member
      .channel(`arena:room:${ROOM}:inputs`)
      .publish("input", encodeInput(1, createInput({ move: [1, 0] })));
    hub.flush();
    for (let index = 0; index < 10; index += 1) {
      loop.advance(1000 / HOST_TICK_HZ);
      hub.flush();
    }
    const after = playersOf(loop.state()).find(
      (player) => player.id === playerId,
    )!;
    expect(after.x).toBeGreaterThan(before.x);
    expect(transport).toBeDefined();
  });

  it("steps a silent player rather than freezing the tick", () => {
    const { hub, loop } = hostOnHub();
    loop.addMember("bo");
    for (let index = 0; index < 10; index += 1) {
      loop.advance(1000 / HOST_TICK_HZ);
      hub.flush();
    }
    expect(loop.state().tick).toBe(10);
    expect(playersOf(loop.state())).toHaveLength(2);
  });

  it("reports the last input sequence it applied, per player", () => {
    const { hub, loop, published } = hostOnHub();
    const member = createMemoryTransport(hub, "bo");
    const playerId = loop.addMember("bo")!;
    void member
      .channel(`arena:room:${ROOM}:inputs`)
      .publish("input", encodeInput(4, createInput({ move: [1, 0] })));
    hub.flush();
    for (let index = 0; index < 3; index += 1) {
      loop.advance(1000 / SNAPSHOT_HZ);
      hub.flush();
    }
    const last = snapshots(published).at(-1)!;
    expect(last.lastInputSeqs[playerId]).toBe(4);
  });

  it("ignores an input from someone who is not in the match", () => {
    const { hub, loop } = hostOnHub();
    const stranger = createMemoryTransport(hub, "nobody");
    void stranger
      .channel(`arena:room:${ROOM}:inputs`)
      .publish("input", encodeInput(1, createInput({ move: [1, 0] })));
    hub.flush();
    loop.advance(1000 / HOST_TICK_HZ);
    hub.flush();
    expect(playersOf(loop.state())).toHaveLength(1);
  });

  it("drops a member and their player when they leave", () => {
    const { hub, loop } = hostOnHub();
    const playerId = loop.addMember("bo")!;
    expect(playersOf(loop.state())).toHaveLength(2);
    loop.removeMember("bo");
    loop.advance(1000 / HOST_TICK_HZ);
    hub.flush();
    expect(playersOf(loop.state())).toHaveLength(1);
    expect(
      playersOf(loop.state()).some((player) => player.id === playerId),
    ).toBe(false);
  });
});

describe("hostLoop failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps healthy peers running through malformed frames from a seated peer", async () => {
    const { hub, loop, published } = hostOnHub();
    loop.addMember("hostile");
    const healthyId = loop.addMember("healthy")!;
    const hostile = createMemoryTransport(hub, "hostile").channel(
      `arena:room:${ROOM}:inputs`,
    );
    const healthy = createMemoryTransport(hub, "healthy").channel(
      `arena:room:${ROOM}:inputs`,
    );
    const before = loop
      .state()
      .players.find((player) => player.id === healthyId)!.x;
    const malformed: unknown[] = [
      null,
      { 0: 1 },
      "oops",
      [],
      [1],
      [1, NaN, 0, -1, 0],
      [2, 0, 0, -1, 256],
      [3, Infinity, 0, -1, 0],
    ];
    for (let tick = 0; tick < 30; tick += 1) {
      await hostile.publish("input", malformed[tick % malformed.length]);
      await healthy.publish(
        "input",
        encodeInput(tick + 1, createInput({ move: [1, 0] })),
      );
      expect(() => hub.flush()).not.toThrow();
      loop.advance(1000 / HOST_TICK_HZ);
    }
    hub.flush();
    expect(loop.state().tick).toBe(30);
    expect(loop.isPublishing()).toBe(true);
    expect(
      loop.state().players.find((player) => player.id === healthyId)!.x,
    ).toBeGreaterThan(before);
    expect(published.length).toBe(10);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports a failing tick to Sentry and skips it rather than throwing", () => {
    const { hub, loop } = hostOnHub(1, flakyStep(1));
    expect(() => {
      loop.advance(1000 / HOST_TICK_HZ);
      hub.flush();
    }).not.toThrow();
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { area: "arena", kind: "host-tick" } }),
    );
    expect(loop.state().tick).toBe(0);
  });

  it("stops publishing after five consecutive failures, so the silence rule re-elects", () => {
    const { hub, loop, published } = hostOnHub(1, flakyStep(5));
    for (let index = 0; index < 20; index += 1) {
      loop.advance(1000 / HOST_TICK_HZ);
      hub.flush();
    }
    expect(loop.isPublishing()).toBe(false);
    const before = published.length;
    for (let index = 0; index < 10; index += 1) {
      loop.advance(1000 / HOST_TICK_HZ);
      hub.flush();
    }
    expect(published).toHaveLength(before);
  });

  it("keeps going when failures are not consecutive", () => {
    let calls = 0;
    const everyFourth: typeof stepArena = (
      state,
      inputs,
      dt,
      stepWorld,
      random,
    ) => {
      calls += 1;
      if (calls % 4 === 0) throw new Error("tick failed");
      return stepArena(state, inputs, dt, stepWorld, random);
    };
    const { hub, loop } = hostOnHub(1, everyFourth);
    for (let index = 0; index < 20; index += 1) {
      loop.advance(1000 / HOST_TICK_HZ);
      hub.flush();
    }
    expect(loop.isPublishing()).toBe(true);
  });

  it("publishes nothing once stopped", () => {
    const { hub, loop, published } = hostOnHub();
    loop.stop();
    for (let index = 0; index < 30; index += 1) {
      loop.advance(1000 / HOST_TICK_HZ);
      hub.flush();
    }
    expect(published).toHaveLength(0);
    expect(loop.state().tick).toBe(0);
  });
});

describe("hostLoop review findings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seats the same client once, however many times they join", () => {
    // A presence recovery or a repeated join message used to seat a second player and leave
    // the first in the state with nobody driving it, quietly using up one of the eight seats.
    const { loop } = hostOnHub(3);
    const first = loop.addMember("bram");
    const again = loop.addMember("bram");
    expect(again).toBe(first);
    expect(playersOf(loop.state())).toHaveLength(2);
  });

  it("stops applying a player's last input once they have gone quiet", () => {
    // Spec §6.3 has clients heartbeat at 2 Hz. A client that stopped publishing — hidden tab,
    // dropped connection — used to keep its last frame applied every tick, so a player who
    // dropped mid-stride walked on forever in the authoritative world.
    const { hub, loop } = hostOnHub(4);
    const playerId = loop.addMember("walker");
    expect(playerId).not.toBeNull();
    const walker = createMemoryTransport(hub, "walker");
    void walker
      .channel(`arena:room:${ROOM}:inputs`)
      .publish("input", encodeInput(1, createInput({ move: [1, 0] })));
    hub.flush();

    const at = () => playersOf(loop.state()).find((p) => p.id === playerId)!.x;
    // One tick per advance throughout: a single long advance is capped at MAX_CATCHUP_TICKS,
    // which would leave the frame younger than the hold window and the test proving nothing.
    const tick = () => loop.advance(1000 / HOST_TICK_HZ);
    const before = at();
    tick();
    expect(at()).not.toBe(before);

    // Silence for longer than the hold window, then time for any deceleration to run out.
    for (let index = 0; index < INPUT_HOLD_TICKS + 10; index += 1) tick();
    const settled = at();
    for (let index = 0; index < 5; index += 1) tick();
    expect(at()).toBe(settled);
  });

  it("reports a snapshot the transport refused to publish, instead of dropping it silently", async () => {
    // A host whose snapshots stop reaching the room looks, to everyone else, like a frozen
    // match; the failure has to reach Sentry rather than vanish as an unhandled rejection.
    const hub = createMemoryHub();
    const real = createMemoryTransport(hub, "host");
    let refusals = 0;
    const refusing: typeof real = {
      ...real,
      channel(name) {
        const channel = real.channel(name);
        if (name !== `arena:room:${ROOM}`) return channel;
        return {
          ...channel,
          publish: async () => {
            refusals += 1;
            throw new Error("message too large");
          },
        };
      },
    };
    const loop = createHostLoop({
      transport: refusing,
      roomCode: ROOM,
      world,
      state: createArenaState({ index, graph, seed: 5, zone }, createRng(5)),
      random: createRng(6),
      serverTimeMs: () => 1000,
    });
    loop.advance(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(refusals).toBeGreaterThan(0);
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "host-snapshot" },
      }),
    );
    loop.stop();
  });
});

describe("hostLoop match phase", () => {
  it("carries where the potje is on every snapshot, so clients follow the host's clock", () => {
    const { hub, loop, published } = hostOnHub(5);
    loop.setMatch({ phase: "countdown", since: 7 });
    for (let index = 0; index < HOST_TICK_HZ / SNAPSHOT_HZ; index += 1) {
      loop.advance(1000 / HOST_TICK_HZ);
      hub.flush();
    }
    expect(published).toHaveLength(1);
    expect(decodeSnapshot(published[0]!.data as Snapshot).match).toEqual({
      phase: "countdown",
      since: 7,
    });
    expect(loop.match()).toEqual({ phase: "countdown", since: 7 });
  });
});

describe("hostLoop migration", () => {
  it("continues from the tally it is given, so a new host does not wipe the score", () => {
    const tally = new Map([[0, { playerId: 0, kills: 2, deaths: 1 }]]);
    const loop = createHostLoop({
      transport: createMemoryTransport(createMemoryHub(), "host"),
      roomCode: ROOM,
      world,
      state: createArenaState({ index, graph, seed: 6, zone }, createRng(6)),
      random: createRng(7),
      serverTimeMs: () => 0,
      tally,
    });
    expect(loop.tally()).toEqual(tally);
    loop.stop();
  });
});
