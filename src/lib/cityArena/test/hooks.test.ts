import { describe, expect, it, vi } from "vitest";
import {
  installArenaHooks,
  type ArenaHookHost,
  type ArenaTestHooks,
} from "./hooks";

function fakeHooks(): ArenaTestHooks {
  return {
    getState: () => null,
    dispatch: vi.fn(),
    damage: vi.fn(),
    getViolations: () => 0,
  };
}

describe("installArenaHooks", () => {
  it("exposes the hooks on the host and removes only its own on uninstall", () => {
    const host: ArenaHookHost = {};
    const mine = fakeHooks();
    const uninstall = installArenaHooks(host, mine);
    expect(host.__arena).toBe(mine);
    const theirs = fakeHooks();
    host.__arena = theirs;
    uninstall();
    expect(host.__arena).toBe(theirs);
    installArenaHooks(host, mine)();
    expect(host.__arena).toBeUndefined();
  });
});
