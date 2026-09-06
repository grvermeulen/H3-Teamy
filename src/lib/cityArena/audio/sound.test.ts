import { describe, expect, it, vi } from "vitest";
import { createFakeAudioContext } from "./testing/fakeAudioContext";
import { createArenaSound } from "./sound";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

describe("createArenaSound", () => {
  it("does not create voices while disabled and unlock is idempotent", () => {
    const { context, factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, false);
    sound.handleEvents([
      { kind: "shot", weapon: "pistol", ownerId: 0, x: 0, y: 0 },
    ]);
    sound.unlock();
    sound.unlock();
    expect(context.oscillators).toHaveLength(0);
    expect(context.resumeCalls).toBe(0);
    sound.setEnabled(true);
    sound.unlock();
    sound.unlock();
    expect(context.resumeCalls).toBe(1);
  });

  it("maps events to short voices and ignores unknown future events", () => {
    const { context, factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true);
    sound.handleEvents([
      { kind: "shot", weapon: "pistol", ownerId: 0, x: 0, y: 0 },
      { kind: "hit", target: "ped", x: 1, y: 1 },
      { kind: "pickup", pickupKind: "health", playerId: 0, x: 2, y: 2 },
      { kind: "explosion", x: 3, y: 3 },
      { kind: "wanted", playerId: 0, level: 2 },
    ]);
    expect(context.oscillators).toHaveLength(5);
    expect(context.oscillators.every((oscillator) => oscillator.started)).toBe(
      true,
    );
  });

  it("keeps one engine oscillator alive and cleans it up", () => {
    const { context, factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true);
    sound.updateEngine(4, true);
    sound.updateEngine(20, true);
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0].frequency.value).toBe(170);
    sound.updateEngine(20, false);
    expect(context.oscillators[0].stopped).toBe(true);
    sound.dispose();
    expect(context.closeCalls).toBe(1);
    sound.dispose();
    expect(context.closeCalls).toBe(1);
  });

  it("mutes immediately and does not replay old events when re-enabled", () => {
    const { context, factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true);
    sound.setEnabled(false);
    sound.handleEvents([
      { kind: "shot", weapon: "uzi", ownerId: 0, x: 0, y: 0 },
    ]);
    expect(context.oscillators).toHaveLength(0);
    sound.setEnabled(true);
    expect(context.oscillators).toHaveLength(0);
  });
});
