import { describe, expect, it } from "vitest";
import { createRng } from "../sim/rng";
import { createMemoryHub, createMemoryTransport } from "./memoryTransport";
import type { PresenceData, RealtimeTransport } from "./transport";
import {
  ROOM_CAPACITY,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  createRoomCode,
  isRoomCode,
  joinRoom,
  leaveRoom,
  openRoom,
  roomChannelName,
  roomInputChannelName,
} from "./room";

const CODE = "ABC234";

/** What a member announces about themselves. */
function presence(name: string): PresenceData {
  return { name, colour: "#f00", role: "player", device: "desktop" };
}

/** A hub with one connected transport per named client. */
async function hubWith(...clientIds: string[]) {
  const hub = createMemoryHub();
  const transports: Record<string, RealtimeTransport> = {};
  for (const clientId of clientIds) {
    const transport = createMemoryTransport(hub, clientId);
    await transport.connect();
    transports[clientId] = transport;
  }
  return { hub, transports };
}

describe("room codes", () => {
  it("is six characters from the code alphabet", () => {
    const code = createRoomCode(createRng(1));
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect([...code].every((c) => ROOM_CODE_ALPHABET.includes(c))).toBe(true);
  });

  it("never contains the characters people misread", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const code = createRoomCode(createRng(seed));
      expect({ seed, has: /[IO01]/.test(code) }).toEqual({ seed, has: false });
    }
  });

  it("is the same code for the same seed", () => {
    expect(createRoomCode(createRng(7))).toBe(createRoomCode(createRng(7)));
  });

  it("stays in range when randomness returns its upper bound", () => {
    expect(createRoomCode(() => 1)).toHaveLength(ROOM_CODE_LENGTH);
    expect(isRoomCode(createRoomCode(() => 1))).toBe(true);
  });

  it("recognises a well-formed code and rejects the rest", () => {
    expect(isRoomCode("ABC234")).toBe(true);
    expect(isRoomCode("ABC23")).toBe(false);
    expect(isRoomCode("ABC2345")).toBe(false);
    expect(isRoomCode("ABC23O")).toBe(false);
    expect(isRoomCode("abc234")).toBe(false);
    expect(isRoomCode("")).toBe(false);
  });

  it("names the room's two channels", () => {
    expect(roomChannelName(CODE)).toBe("arena:room:ABC234");
    expect(roomInputChannelName(CODE)).toBe("arena:room:ABC234:inputs");
  });
});

describe("joining a room", () => {
  it("refuses a room nobody is in", async () => {
    const { transports } = await hubWith("a");
    expect(await joinRoom(transports.a!, CODE, presence("Ann"))).toEqual({
      ok: false,
      reason: "room-empty",
    });
  });

  it("joins a room that has a host in it", async () => {
    const { transports } = await hubWith("a", "b");
    await openRoom(transports.a!, CODE, presence("Ann"));
    const result = await joinRoom(transports.b!, CODE, presence("Bo"));
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.members.map((member) => member.clientId)).toEqual([
        "a",
        "b",
      ]);
  });

  it("refuses a room that is already full", async () => {
    const ids = Array.from({ length: ROOM_CAPACITY + 1 }, (_, i) => `p${i}`);
    const { transports } = await hubWith(...ids);
    await openRoom(transports[ids[0]!]!, CODE, presence("host"));
    for (const id of ids.slice(1, ROOM_CAPACITY))
      await joinRoom(transports[id]!, CODE, presence(id));
    const last = ids[ROOM_CAPACITY]!;
    expect(await joinRoom(transports[last]!, CODE, presence(last))).toEqual({
      ok: false,
      reason: "room-full",
    });
  });

  it("fits exactly the capacity, not one fewer", async () => {
    const ids = Array.from({ length: ROOM_CAPACITY }, (_, i) => `p${i}`);
    const { transports } = await hubWith(...ids);
    await openRoom(transports[ids[0]!]!, CODE, presence("host"));
    for (const id of ids.slice(1)) {
      const result = await joinRoom(transports[id]!, CODE, presence(id));
      expect({ id, ok: result.ok }).toEqual({ id, ok: true });
    }
  });

  it("frees a place when someone leaves", async () => {
    const ids = Array.from({ length: ROOM_CAPACITY + 1 }, (_, i) => `p${i}`);
    const { transports } = await hubWith(...ids);
    await openRoom(transports[ids[0]!]!, CODE, presence("host"));
    for (const id of ids.slice(1, ROOM_CAPACITY))
      await joinRoom(transports[id]!, CODE, presence(id));
    await leaveRoom(transports[ids[1]!]!, CODE);
    const last = ids[ROOM_CAPACITY]!;
    expect((await joinRoom(transports[last]!, CODE, presence(last))).ok).toBe(
      true,
    );
  });

  it("becomes empty again once the last member leaves", async () => {
    const { transports } = await hubWith("a", "b");
    await openRoom(transports.a!, CODE, presence("Ann"));
    await leaveRoom(transports.a!, CODE);
    expect(await joinRoom(transports.b!, CODE, presence("Bo"))).toEqual({
      ok: false,
      reason: "room-empty",
    });
  });
});
