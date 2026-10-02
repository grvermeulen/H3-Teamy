import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import { createCollisionGrid } from "../world/collisionGrid";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaPlayer } from "../sim/roster";
import { createInput } from "../sim/types";
import { arenaChannels, type ArenaRoomTicket } from "./roomProtocol";
import { createMemoryHub, createMemoryTransport } from "./memoryTransport";
import { createArenaScreenRuntime } from "./screenRuntime";
import { emptyObserverState } from "./observerLoop";
import { encodeSnapshot } from "./snapshotWire";
import { encodeInput } from "./wire";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-13T10:00:00Z",
  origin: { lat: 52, lon: 5 },
  unitsPerMetre: 4,
  bounds: { minX: -8000, minY: -8000, maxX: 8000, maxY: 8000 },
  tileSize: 8000,
  tiles: [],
  landmarks: [],
  zones: [
    {
      key: "campus",
      name: "Campus",
      center: [0, 0],
      radius: 2000,
      spawnNodes: [
        [0, 0],
        [400, 0],
      ],
      landmarks: [],
    },
  ],
};
const session = {
  index: () => index,
  graph: () =>
    decodeRoadGraph({
      nodes: [0, 0, 400, 0],
      edges: [0, 1, 0, -1, 0, 400],
      classes: ["residential"],
      names: [],
    }),
  collision: createCollisionGrid(),
};
const ticket: ArenaRoomTicket = {
  roomId: "room",
  roomCode: "ABC234",
  zone: "campus",
  memberId: "screen",
  hostClientId: "screen",
  epoch: 1,
  leaseUntil: 12000,
  serverTime: 1000,
  round: null,
  members: [
    { clientId: "screen", name: "Scherm", role: "display", joinedAt: 0 },
    { clientId: "second", name: "Tweede scherm", role: "display", joinedAt: 1 },
    { clientId: "phone", name: "Speler", role: "controller", joinedAt: 2 },
  ],
};

describe("shared screen authority", () => {
  it("seats only real players and applies controller input without a local avatar", async () => {
    const hub = createMemoryHub();
    const transport = createMemoryTransport(hub, "screen");
    const phone = createMemoryTransport(hub, "phone");
    const runtime = createArenaScreenRuntime(session, ticket, () => 1000);
    expect(runtime.state().players).toEqual([]);
    runtime.sync(ticket, transport, true);
    expect([...runtime.seats().keys()]).toEqual(["phone"]);
    expect(runtime.state().players).toHaveLength(1);
    const before = runtime.state().players[0]!.x;
    await phone
      .channel(arenaChannels(ticket.roomId, ticket.epoch).inputs)
      .publish("input", encodeInput(1, createInput({ move: [1, 0] })));
    hub.flush();
    runtime.advance(100);
    expect(runtime.state().players[0]!.x).toBeGreaterThan(before);
    runtime.sync(
      {
        ...ticket,
        members: ticket.members.filter((member) => member.role === "display"),
      },
      transport,
      true,
    );
    expect(runtime.state().players).toHaveLength(0);
    expect([...runtime.accounts().keys()]).toEqual(["phone"]);
    runtime.stop();
  });

  it("takes over the observed positions, scores and departed roster without accepting an old epoch", async () => {
    const hub = createMemoryHub();
    const oldHost = createMemoryTransport(hub, "screen");
    const nextHost = createMemoryTransport(hub, "second");
    const runtime = createArenaScreenRuntime(
      session,
      { ...ticket, memberId: "second" },
      () => 2000,
    );
    runtime.sync({ ...ticket, memberId: "second" }, nextHost, true);
    const state = {
      ...emptyObserverState("campus"),
      tick: 42,
      nextId: 10,
      players: [{ ...createArenaPlayer([24, 31], 3), id: 3, health: 57 }],
    };
    const snapshot = encodeSnapshot(
      state,
      1000,
      {},
      {
        seats: new Map([["phone", 3]]),
        accounts: new Map([
          ["phone", 3],
          ["departed", 4],
        ]),
        tally: new Map([
          [3, { playerId: 3, kills: 2, deaths: 1 }],
          [4, { playerId: 4, kills: 1, deaths: 2 }],
        ]),
        match: { phase: "playing", since: 10 },
      },
    );
    await oldHost
      .channel(arenaChannels(ticket.roomId, 1).state)
      .publish("state", snapshot);
    hub.flush();
    expect(runtime.hasSnapshot()).toBe(true);
    expect(runtime.match()?.phase).toBe("playing");
    const takeover = {
      ...ticket,
      memberId: "second",
      hostClientId: "second",
      epoch: 2,
    };
    runtime.sync(takeover, nextHost, true);
    expect(runtime.state().players).toMatchObject([
      { id: 3, x: 24, y: 31, health: 57 },
    ]);
    expect(runtime.tally().get(3)?.kills).toBe(2);
    expect(runtime.accounts().get("departed")).toBe(4);
    expect(runtime.seats().size).toBe(1);
    await oldHost
      .channel(arenaChannels(ticket.roomId, 1).state)
      .publish("state", { ...snapshot, t: 999 });
    hub.flush();
    expect(runtime.state().tick).toBe(42);
    runtime.advance(100);
    expect(runtime.state().tick).toBe(45);
    runtime.sync(
      { ...takeover, hostClientId: null, epoch: 3 },
      nextHost,
      false,
    );
    runtime.advance(1000);
    expect(runtime.state().tick).toBe(45);
    runtime.stop();
  });
});
