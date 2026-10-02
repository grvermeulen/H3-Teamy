import { describe, expect, it } from "vitest";
import { createMemoryHub, createMemoryTransport } from "./memoryTransport";
import type { PresenceData, PresenceMember } from "./transport";
import {
  LOBBY_CHANNEL,
  enterLobby,
  leaveLobby,
  listLobbyRooms,
  parseLobbyRoom,
  roomsFromPresence,
  updateLobby,
} from "./lobbyPresence";

/** The host's own presence data. */
const HOST: PresenceData = {
  name: "Noor",
  colour: "#f5a524",
  role: "player",
  device: "desktop",
};

/** A well-formed room summary. */
const ROOM = {
  roomCode: "7K4M2Q",
  zone: "wageningen" as const,
  players: 3,
  phase: "lobby" as const,
};

/** A lobby presence member carrying `room`. */
function member(
  clientId: string,
  room: unknown,
  timestamp = 1,
  name = "Noor",
): PresenceMember {
  return {
    clientId,
    data: { ...HOST, name, room } as PresenceData,
    timestamp,
  };
}

describe("parseLobbyRoom", () => {
  it("reads a well-formed room", () => {
    expect(parseLobbyRoom(member("a", ROOM))).toEqual({
      roomCode: "7K4M2Q",
      zone: "wageningen",
      hostName: "Noor",
      players: 3,
      phase: "lobby",
    });
  });

  it("ignores a member who is not advertising a room", () => {
    expect(parseLobbyRoom(member("a", undefined))).toBeNull();
  });

  it("drops an entry whose room code could not be real", () => {
    expect(
      parseLobbyRoom(member("a", { ...ROOM, roomCode: "nope" })),
    ).toBeNull();
    expect(
      parseLobbyRoom(member("a", { ...ROOM, roomCode: "ABC23O" })),
    ).toBeNull();
  });

  it("drops an entry with an unknown zone or a broken player count", () => {
    expect(
      parseLobbyRoom(member("a", { ...ROOM, zone: "atlantis" })),
    ).toBeNull();
    expect(parseLobbyRoom(member("a", { ...ROOM, players: -1 }))).toBeNull();
    expect(parseLobbyRoom(member("a", { ...ROOM, players: 2.5 }))).toBeNull();
    expect(parseLobbyRoom(member("a", { ...ROOM, phase: "over" }))).toBeNull();
  });

  it("survives junk from a peer rather than throwing", () => {
    for (const junk of [null, "room", 42, [], { roomCode: 1 }])
      expect(parseLobbyRoom(member("a", junk))).toBeNull();
  });

  it("falls back to a placeholder when the host has no name", () => {
    expect(parseLobbyRoom(member("a", ROOM, 1, "  "))?.hostName).toBe(
      "Onbekend",
    );
  });
});

describe("roomsFromPresence", () => {
  it("returns one room per member advertising one", () => {
    const rooms = roomsFromPresence([
      member("a", ROOM, 1),
      member("b", { ...ROOM, roomCode: "ABC234", players: 5 }, 2),
    ]);
    expect(rooms.map((room) => room.roomCode)).toEqual(["7K4M2Q", "ABC234"]);
  });

  it("skips members who advertise nothing", () => {
    expect(
      roomsFromPresence([member("a", undefined, 1), member("b", ROOM, 2)]),
    ).toHaveLength(1);
  });

  it("keeps the later host when two advertise the same code", () => {
    const rooms = roomsFromPresence([
      member("old", { ...ROOM, players: 2 }, 1, "Oud"),
      member("new", { ...ROOM, players: 6 }, 9, "Nieuw"),
    ]);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.hostName).toBe("Nieuw");
    expect(rooms[0]!.players).toBe(6);
  });

  it("is empty when nobody is hosting", () => {
    expect(roomsFromPresence([])).toEqual([]);
  });
});

describe("advertising a room", () => {
  it("puts the room in the lobby, updates it, and takes it away again", async () => {
    const hub = createMemoryHub();
    const host = createMemoryTransport(hub, "host");
    const watcher = createMemoryTransport(hub, "watcher");
    await host.connect();
    await watcher.connect();

    await enterLobby(host, { host: HOST, room: ROOM });
    let rooms = await listLobbyRooms(watcher);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ roomCode: "7K4M2Q", players: 3 });

    await updateLobby(host, {
      host: HOST,
      room: { ...ROOM, players: 6, phase: "playing" },
    });
    rooms = await listLobbyRooms(watcher);
    expect(rooms[0]).toMatchObject({ players: 6, phase: "playing" });

    await leaveLobby(host);
    expect(await listLobbyRooms(watcher)).toEqual([]);
  });

  it("advertises on the lobby channel, not the room's own", async () => {
    const hub = createMemoryHub();
    const host = createMemoryTransport(hub, "host");
    await host.connect();
    await enterLobby(host, { host: HOST, room: ROOM });
    const members = await host.channel(LOBBY_CHANNEL).presence.get();
    expect(members).toHaveLength(1);
    expect(
      await host.channel(`arena:room:${ROOM.roomCode}`).presence.get(),
    ).toEqual([]);
  });
});
