import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { useArenaWakeLock } from "./useArenaWakeLock";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));
function sentinel() {
  const target = new EventTarget();
  return Object.assign(target, {
    released: false,
    type: "screen" as const,
    onrelease: null,
    release: vi.fn(async () => {
      Object.assign(target, { released: true });
      target.dispatchEvent(new Event("release"));
    }),
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("arena screen wake lock", () => {
  it("reacquires a released lock after returning to the tab and cleans up on leave", async () => {
    const first = sentinel();
    const second = sentinel();
    const request = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    vi.stubGlobal("navigator", { wakeLock: { request } });
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const hook = renderHook(useArenaWakeLock);
    await waitFor(() => expect(hook.result.current).toBe(true));
    await act(() => first.release());
    expect(hook.result.current).toBe(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(hook.result.current).toBe(true);
    hook.unmount();
    expect(second.release).toHaveBeenCalledOnce();
  });
  it("releases a late grant after unmount instead of keeping the screen awake", async () => {
    const lock = sentinel();
    let grant!: (value: WakeLockSentinel) => void;
    const request = vi.fn(
      () =>
        new Promise<WakeLockSentinel>((resolve) => {
          grant = resolve;
        }),
    );
    vi.stubGlobal("navigator", { wakeLock: { request } });
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const hook = renderHook(useArenaWakeLock);
    hook.unmount();
    await act(async () => {
      grant(lock);
    });
    expect(lock.release).toHaveBeenCalledOnce();
  });
  it("treats denied wake locks as optional browser functionality", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    vi.stubGlobal("navigator", { wakeLock: { request } });
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const hook = renderHook(useArenaWakeLock);
    await waitFor(() => expect(Sentry.addBreadcrumb).toHaveBeenCalledOnce());
    expect(hook.result.current).toBe(false);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    hook.unmount();
  });
});
