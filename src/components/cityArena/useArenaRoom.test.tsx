import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryHub,
  createMemoryTransport,
} from "@/lib/cityArena/net/memoryTransport";
import { roomTicket } from "@/lib/cityArena/net/roomProtocol.testFixtures";
import { ArenaRequestError } from "@/lib/cityArena/net/roomClient";
import { useArenaRoom } from "./useArenaRoom";
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

describe("server-approved arena room hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function setup() {
    let ticket = roomTicket();
    const send = vi.fn(async () => ticket);
    const transport = createMemoryTransport(createMemoryHub(), ticket.memberId);
    const refreshAuth = vi.fn(async () => ticket);
    const createTransport = vi.fn(() => ({ ...transport, refreshAuth }));
    const hook = renderHook(() =>
      useArenaRoom({
        entry: { kind: "new", zone: "campus" },
        fallbackZone: "campus",
        roomClient: send,
        createTransport,
      }),
    );
    return {
      ...hook,
      send,
      createTransport,
      refreshAuth,
      setTicket: (next: typeof ticket) => {
        ticket = next;
      },
    };
  }
  async function settle() {
    await act(async () => {
      for (let step = 0; step < 20; step += 1) await Promise.resolve();
    });
  }
  it("opens only the server-approved seat and reports the server's crew and host", async () => {
    const test = setup();
    await settle();
    expect(test.result.current.failure).toBeNull();
    expect(test.result.current.status).toBe("ready");
    expect(test.result.current.roomCode).toBe("ABC234");
    expect(test.result.current.clientId).toBe(roomTicket().memberId);
    expect(test.result.current.isHost).toBe(true);
    expect(test.createTransport).toHaveBeenCalledWith({
      authUrl: "/api/arena/realtime-token?memberId=" + roomTicket().memberId,
    });
    expect(test.send.mock.calls[0][0]).toMatchObject({
      action: "create",
      zone: "campus",
    });
  });
  it("creates only one membership when React replays the initial effect", async () => {
    const ticket = roomTicket();
    const send = vi.fn(async () => ticket);
    const createTransport = () =>
      createMemoryTransport(createMemoryHub(), ticket.memberId);
    const hook = renderHook(
      () =>
        useArenaRoom({
          entry: { kind: "new", zone: "campus" },
          fallbackZone: "campus",
          roomClient: send,
          createTransport,
        }),
      { wrapper: StrictMode },
    );
    await settle();
    expect(hook.result.current.status).toBe("ready");
    expect(
      send.mock.calls.filter(([command]) => command.action === "create"),
    ).toHaveLength(1);
    expect(
      send.mock.calls.filter(([command]) => command.action === "leave"),
    ).toHaveLength(0);
  });
  it("does not elect a host locally when another client reports silence", async () => {
    const test = setup();
    await settle();
    act(() => test.result.current.reportHostLost("another-client"));
    await settle();
    expect(test.result.current.hostClientId).toBe(roomTicket().memberId);
    expect(test.refreshAuth).not.toHaveBeenCalled();
  });
  it("refreshes capabilities before adopting a server host migration", async () => {
    const test = setup();
    await settle();
    const nextHost = "33333333-3333-4333-8333-333333333333";
    test.setTicket(roomTicket({ hostClientId: nextHost, epoch: 2 }));
    act(() => test.result.current.reportHostLost(roomTicket().memberId));
    await settle();
    expect(test.refreshAuth).toHaveBeenCalledTimes(1);
    expect(test.result.current.hostClientId).toBe(nextHost);
    expect(test.result.current.isHost).toBe(false);
  });
  it("submits starts with the current seat and epoch and leaves on unmount", async () => {
    const test = setup();
    await settle();
    await act(async () => {
      await test.result.current.startRound();
    });
    expect(test.send).toHaveBeenCalledWith({
      action: "start",
      memberId: roomTicket().memberId,
      epoch: 1,
    });
    test.unmount();
    expect(test.send).toHaveBeenCalledWith(
      { action: "leave", memberId: roomTicket().memberId },
      true,
    );
  });
  it("never opens a transport when the server refuses membership", async () => {
    const createTransport = vi.fn();
    const { result } = renderHook(() =>
      useArenaRoom({
        entry: { kind: "new", zone: "campus" },
        fallbackZone: "campus",
        createTransport,
        roomClient: async () => {
          throw new ArenaRequestError("Log in om te spelen", 401);
        },
      }),
    );
    await settle();
    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toBe("Log in om te spelen");
    expect(createTransport).not.toHaveBeenCalled();
  });
});
