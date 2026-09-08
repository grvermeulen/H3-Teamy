import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterLobby, listLobbyRooms } from "@/lib/cityArena/net/lobbyPresence";
import {
  createMemoryHub,
  createMemoryTransport,
  type MemoryHub,
} from "@/lib/cityArena/net/memoryTransport";
import { openRoom } from "@/lib/cityArena/net/room";
import type { PresenceData } from "@/lib/cityArena/net/transport";
import type { ArenaEntry } from "./arenaEntry";
import { useArenaRoom } from "./useArenaRoom";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const ROOM = "ABC234";

/** Presence data for a desktop player. */
function player(name: string): PresenceData {
  return { name, colour: "#fff", role: "player", device: "desktop" };
}

/** Lets the hook's connection sequence — a handful of awaits — run to the end. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
}

/** Renders the hook as "me", called Guido, over `hub`. */
function renderRoom(hub: MemoryHub, entry: ArenaEntry) {
  return renderHook(() =>
    useArenaRoom({
      entry,
      fallbackZone: "wageningen",
      createTransport: () => createMemoryTransport(hub, "me", "Guido"),
    }),
  );
}

/** A room already open on the hub, hosted by Bram, who advertises it in the lobby. */
async function bramsRoom(hub: MemoryHub): Promise<void> {
  const bram = createMemoryTransport(hub, "bram", "Bram");
  await openRoom(bram, ROOM, player("Bram"));
  await enterLobby(bram, {
    host: player("Bram"),
    room: { roomCode: ROOM, zone: "wageningen", players: 1, phase: "lobby" },
  });
}

describe("useArenaRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens a fresh room as host and advertises it in the lobby", async () => {
    const hub = createMemoryHub();
    const { result } = renderRoom(hub, { kind: "new", zone: "campus" });
    await settle();
    expect(result.current.status).toBe("ready");
    expect(result.current.isHost).toBe(true);
    expect(result.current.hostClientId).toBe("me");
    expect(result.current.clientId).toBe("me");
    expect(result.current.crew).toEqual([
      { clientId: "me", seat: 0, name: "Guido", isHost: true, isYou: true },
    ]);
    const rooms = await listLobbyRooms(createMemoryTransport(hub, "watcher"));
    expect(rooms).toEqual([
      expect.objectContaining({
        roomCode: result.current.roomCode,
        zone: "campus",
        hostName: "Guido",
      }),
    ]);
  });

  it("joins an open room behind its host, in join order", async () => {
    const hub = createMemoryHub();
    await bramsRoom(hub);
    const { result } = renderRoom(hub, {
      kind: "join",
      roomCode: ROOM,
      zone: "wageningen",
    });
    await settle();
    expect(result.current.status).toBe("ready");
    expect(result.current.isHost).toBe(false);
    expect(result.current.hostClientId).toBe("bram");
    expect(result.current.crew.map((member) => member.clientId)).toEqual([
      "bram",
      "me",
    ]);
  });

  it("re-elects without a host it was told is lost, and the new host takes the lobby", async () => {
    const hub = createMemoryHub();
    await bramsRoom(hub);
    const { result } = renderRoom(hub, {
      kind: "join",
      roomCode: ROOM,
      zone: "wageningen",
    });
    await settle();
    act(() => result.current.reportHostLost("bram"));
    expect(result.current.hostClientId).toBe("me");
    expect(result.current.isHost).toBe(true);
    expect(result.current.crew.find((member) => member.isHost)?.clientId).toBe(
      "me",
    );
    await settle();
    // Bram's advert is superseded: the lobby lists the room under its new host.
    const rooms = await listLobbyRooms(createMemoryTransport(hub, "watcher"));
    expect(rooms).toEqual([
      expect.objectContaining({ roomCode: ROOM, hostName: "Guido" }),
    ]);
  });

  it("keeps hosting when told it is lost itself and nobody else is there", async () => {
    const hub = createMemoryHub();
    const { result } = renderRoom(hub, { kind: "new", zone: "campus" });
    await settle();
    act(() => result.current.reportHostLost("me"));
    expect(result.current.isHost).toBe(true);
  });
});
