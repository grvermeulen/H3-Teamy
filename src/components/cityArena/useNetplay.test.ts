import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCollisionGrid } from "@/lib/cityArena/world/collisionGrid";
import type { MapIndex, MapZone } from "@/lib/cityArena/world/mapTypes";
import { decodeRoadGraph } from "@/lib/cityArena/world/roadGraph";
import { createArenaState } from "@/lib/cityArena/sim/arena";
import { playersOf } from "@/lib/cityArena/sim/players";
import { createRng } from "@/lib/cityArena/sim/rng";
import {
  createMemoryHub,
  createMemoryTransport,
  type MemoryHub,
} from "@/lib/cityArena/net/memoryTransport";
import { HOST_TICK_HZ } from "@/lib/cityArena/net/hostLoop";
import type { Runtime } from "./arenaRuntime";
import { useNetplay, type ArenaNetplayOptions } from "./useNetplay";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

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
const ROOM = "ABC234";
/** One snapshot's worth of host time. */
const SNAPSHOT_MS = (1000 / HOST_TICK_HZ) * 3;

/**
 * The slice of the runtime the netplay hook touches: a booted world, a seeded rng, a sound sink
 * and the netplay slot itself. Nothing here renders, so no canvas or session is needed.
 */
function fakeRuntime(seed: number): Runtime {
  return {
    session: {
      collision: createCollisionGrid(),
      index: () => index,
      graph: () => graph,
    },
    state: createArenaState({ index, graph, seed, zone }, createRng(seed)),
    random: createRng(seed + 1),
    sound: { handleEvents: vi.fn() },
    netplay: { kind: "offline", playerId: 0 },
    disposed: false,
  } as unknown as Runtime;
}

/** Options for one member of the room. */
function member(
  hub: MemoryHub,
  clientId: string,
  overrides: Partial<ArenaNetplayOptions> = {},
): ArenaNetplayOptions {
  const transport = createMemoryTransport(hub, clientId);
  return {
    transport: () => transport,
    ready: true,
    roomCode: ROOM,
    clientId,
    clockOffsetMs: 0,
    isHost: false,
    memberIds: [clientId],
    ...overrides,
  };
}

/**
 * Renders the hook for one runtime, re-renderable with new options. The ref is created once, as
 * `useRef` would: a fresh one per render would re-run the loop effect on every rerender.
 */
function renderNetplay(runtime: Runtime, options: ArenaNetplayOptions) {
  const runtimeRef = { current: runtime };
  return renderHook(
    (props: { options: ArenaNetplayOptions; booted: boolean }) =>
      useNetplay(runtimeRef, props.booted, props.options),
    { initialProps: { options, booted: true } },
  );
}

/** Runs the host's loop for one snapshot and delivers it. */
function publishSnapshot(host: Runtime, hub: MemoryHub): void {
  if (host.netplay.kind !== "host") throw new Error("not hosting");
  host.netplay.loop.advance(SNAPSHOT_MS);
  hub.flush();
}

/**
 * A host and a joiner on one hub, the joiner seated and following the host's world. The options
 * come back too: a rerender must reuse them, because a fresh transport would be a new room.
 */
function seatedPair() {
  const hub = createMemoryHub();
  const host = fakeRuntime(1);
  const joiner = fakeRuntime(2);
  const crew = ["host", "joiner"];
  const hostOptions = member(hub, "host", { isHost: true, memberIds: crew });
  const joinerOptions = member(hub, "joiner", { memberIds: crew });
  const hostHook = renderNetplay(host, hostOptions);
  const joinerHook = renderNetplay(joiner, joinerOptions);
  publishSnapshot(host, hub);
  return {
    hub,
    host,
    joiner,
    hostHook,
    joinerHook,
    hostOptions,
    joinerOptions,
  };
}

describe("useNetplay", () => {
  afterEach(() => {
    cleanup();
  });

  it("does nothing without a room, and nothing before the room is ready", () => {
    const hub = createMemoryHub();
    const alone = fakeRuntime(1);
    renderNetplay(alone, undefined as unknown as ArenaNetplayOptions);
    expect(alone.netplay.kind).toBe("offline");

    const waiting = fakeRuntime(2);
    renderNetplay(
      waiting,
      member(hub, "waiting", { isHost: true, ready: false }),
    );
    expect(waiting.netplay.kind).toBe("offline");
  });

  it("hosts as player 0 and seats the crew from presence", () => {
    const { host } = seatedPair();
    expect(host.netplay.kind).toBe("host");
    expect(host.netplay.kind === "host" && host.netplay.playerId).toBe(0);
    if (host.netplay.kind !== "host") throw new Error("not hosting");
    expect(host.netplay.loop.seats().get("host")).toBe(0);
    expect(host.netplay.loop.seats().has("joiner")).toBe(true);
    expect(playersOf(host.state)).toHaveLength(2);
  });

  it("seats a joiner from the first snapshot that names it, in the host's world", () => {
    const { host, joiner } = seatedPair();
    if (host.netplay.kind !== "host") throw new Error("not hosting");
    const seat = host.netplay.loop.seats().get("joiner");
    expect(joiner.netplay.kind).toBe("client");
    expect(joiner.netplay.kind === "client" && joiner.netplay.playerId).toBe(
      seat,
    );
    // The joiner's own offline city is gone: it now draws the host's players, both of them.
    expect(playersOf(joiner.state).map((player) => player.id)).toEqual(
      playersOf(host.state).map((player) => player.id),
    );
  });

  it("leaves a client roaming alone while the host has not seated it", () => {
    const hub = createMemoryHub();
    const host = fakeRuntime(1);
    const stranger = fakeRuntime(2);
    renderNetplay(host, member(hub, "host", { isHost: true }));
    renderNetplay(stranger, member(hub, "stranger", { memberIds: ["host"] }));
    publishSnapshot(host, hub);
    expect(stranger.netplay.kind).toBe("offline");
    expect(playersOf(stranger.state)).toHaveLength(1);
  });

  it("unseats a member who leaves and keeps everyone else", () => {
    const { host, hostHook, hostOptions } = seatedPair();
    hostHook.rerender({
      options: { ...hostOptions, memberIds: ["host"] },
      booted: true,
    });
    if (host.netplay.kind !== "host") throw new Error("not hosting");
    expect(host.netplay.loop.seats().has("joiner")).toBe(false);
    expect(playersOf(host.state).map((player) => player.id)).toEqual([0]);
  });

  it("does not recreate the host loop when the crew changes", () => {
    const { host, hostHook, hostOptions } = seatedPair();
    if (host.netplay.kind !== "host") throw new Error("not hosting");
    const loop = host.netplay.loop;
    hostHook.rerender({
      options: { ...hostOptions, memberIds: ["host", "joiner", "third"] },
      booted: true,
    });
    expect(host.netplay.kind === "host" && host.netplay.loop).toBe(loop);
    expect(loop.seats().has("third")).toBe(true);
  });

  it("lets an elected client take over hosting with its own seat and the crew intact", () => {
    const { host, joiner, hostHook, joinerHook, joinerOptions } = seatedPair();
    if (joiner.netplay.kind !== "client") throw new Error("not a client");
    const seat = joiner.netplay.playerId;
    // The host closes its tab: its presence leaves, and the joiner is elected.
    hostHook.unmount();
    joinerHook.rerender({
      options: { ...joinerOptions, isHost: true, memberIds: ["joiner"] },
      booted: true,
    });
    expect(joiner.netplay.kind).toBe("host");
    if (joiner.netplay.kind !== "host") throw new Error("not hosting");
    expect(joiner.netplay.playerId).toBe(seat);
    expect(joiner.netplay.loop.seats().get("joiner")).toBe(seat);
    // The old host's player is gone with it; nobody else was spawned in its place.
    expect(playersOf(joiner.state).map((player) => player.id)).toEqual([seat]);
    expect(host.netplay.kind).toBe("offline");
  });

  it("stops the loop and goes back to stepping alone on unmount, still driving its player", () => {
    const { host, joiner, hostHook, joinerHook } = seatedPair();
    if (joiner.netplay.kind !== "client") throw new Error("not a client");
    const seat = joiner.netplay.playerId;
    hostHook.unmount();
    joinerHook.unmount();
    expect(host.netplay).toEqual({ kind: "offline", playerId: 0 });
    // A client that lost its room keeps its seat: player 0 was the host, who is gone.
    expect(joiner.netplay).toEqual({ kind: "offline", playerId: seat });
  });
});
