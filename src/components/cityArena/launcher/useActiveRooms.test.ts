import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { ROOMS_POLL_MS, useActiveRooms } from "./useActiveRooms";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

/** A fetch that answers the rooms route with `rooms`, counting how often it was asked. */
function serving(rooms: unknown[]): ReturnType<typeof vi.fn> {
  return vi.fn(
    async () => new Response(JSON.stringify({ rooms }), { status: 200 }),
  );
}

/** Flushes the promise chain behind a fetch, under fake timers. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useActiveRooms", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts loading, then reports the rooms the route serves", async () => {
    const fetchMock = serving([{ roomCode: "7K4M2Q" }]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useActiveRooms(true));
    expect(result.current).toEqual({ status: "loading" });
    await settle();
    expect(result.current).toEqual({
      status: "ready",
      rooms: [{ roomCode: "7K4M2Q" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not poll for a signed-out visitor", async () => {
    const fetchMock = serving([]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useActiveRooms(false));
    await settle();
    expect(result.current).toEqual({ status: "ready", rooms: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("polls again after the interval, and only once per interval", async () => {
    const fetchMock = serving([]);
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useActiveRooms(true));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(ROOMS_POLL_MS);
    });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("goes offline and tells Sentry when the route fails, rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const { result } = renderHook(() => useActiveRooms(true));
    await settle();
    expect(result.current).toEqual({ status: "offline" });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { area: "arena", kind: "rooms-poll" } }),
    );
  });

  it("stops polling once unmounted, even if a fetch was mid-flight", async () => {
    // The regression this guards: a fetch resolving after unmount used to schedule the next
    // poll anyway, leaving a chain running against a card that no longer exists.
    let release: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve(
              new Response(JSON.stringify({ rooms: [] }), { status: 200 }),
            );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderHook(() => useActiveRooms(true));
    unmount();
    await act(async () => {
      release?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(ROOMS_POLL_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pauses while the tab is hidden and does not double up when it returns", async () => {
    const fetchMock = serving([]);
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useActiveRooms(true));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      vi.advanceTimersByTime(ROOMS_POLL_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(ROOMS_POLL_MS);
    });
    await settle();
    // One chain, not two: exactly one more request per interval after returning.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
