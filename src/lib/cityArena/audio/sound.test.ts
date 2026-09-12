import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClipName } from "./clips";
import type { RadioPlayer } from "./radio/radio";
import { createSamplePlayer, type SamplePlayer } from "./samples";
import { createFakeAudioContext } from "./testing/fakeAudioContext";
import {
  ENGINE_RATE_MAX,
  ENGINE_RATE_MIN,
  ENGINE_RATE_TOP_SPEED_MPS,
  createArenaSound,
  engineRate,
} from "./sound";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

/** A sample player that has exactly the clips named, and remembers what it was asked to play. */
function playerWith(clips: ClipName[]): SamplePlayer {
  return {
    preload: vi.fn(async () => undefined),
    play: vi.fn((clip: ClipName) => clips.includes(clip)),
    startLoop: vi.fn(() => null),
    has: (clip: ClipName) => clips.includes(clip),
  };
}

describe("createArenaSound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("voices a cannon shot with the explosion clip, and the bass fallback without it", () => {
    const player = playerWith(["explosion"]);
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.unlock();
    sound.handleEvents([
      { kind: "shot", weapon: "cannon", ownerId: 0, x: 0, y: 0 },
    ]);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledWith("explosion");
    const { context, factory: bare } = createFakeAudioContext();
    const silent = createArenaSound(bare, true, () => playerWith([]));
    silent.unlock();
    silent.handleEvents([
      { kind: "shot", weapon: "cannon", ownerId: 0, x: 0, y: 0 },
    ]);
    expect(context.oscillators).toHaveLength(1);
  });

  it("maps events to short voices and ignores unknown future events", () => {
    const { context, factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true);
    sound.handleEvents([
      { kind: "shot", weapon: "pistol", ownerId: 0, x: 0, y: 0 },
      { kind: "hit", target: "ped", ownerId: 0, x: 1, y: 1 },
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

  it("prefers a recorded clip and keeps the oscillator for a clip it does not have", () => {
    const { context, factory } = createFakeAudioContext();
    const player = playerWith(["pistol", "explosion"]);
    const sound = createArenaSound(factory, true, () => player);
    sound.handleEvents([
      { kind: "shot", weapon: "pistol", ownerId: 0, x: 0, y: 0 },
      { kind: "explosion", x: 3, y: 3 },
      { kind: "shot", weapon: "uzi", ownerId: 0, x: 0, y: 0 },
      { kind: "shot", weapon: "fist", ownerId: 0, x: 0, y: 0 },
    ]);
    // The pistol and the explosion played from clips; the uzi fell back; the fist is synth-only.
    expect(vi.mocked(player.play).mock.calls.map(([clip]) => clip)).toEqual([
      "pistol",
      "explosion",
      "uzi",
    ]);
    expect(context.oscillators).toHaveLength(2);
  });

  it("fetches the clips on the first unlock, and only then", () => {
    const { factory } = createFakeAudioContext();
    const player = playerWith([]);
    const sound = createArenaSound(factory, true, () => player);
    sound.handleEvents([{ kind: "explosion", x: 3, y: 3 }]);
    expect(player.preload).not.toHaveBeenCalled();
    sound.unlock();
    sound.unlock();
    expect(player.preload).toHaveBeenCalledTimes(1);
  });

  it("sounds exactly as before when no audio file exists on the server", async () => {
    // Plan 6 acceptance 1: the branch is playable before a single clip has been sourced.
    const { context, factory } = createFakeAudioContext();
    const notFound = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof fetch;
    let player: SamplePlayer | null = null;
    const sound = createArenaSound(factory, true, (audio, destination) => {
      player = createSamplePlayer(context, destination, notFound);
      return audio === context ? player : null;
    });
    sound.unlock();
    await player!.preload();
    sound.handleEvents([
      { kind: "shot", weapon: "pistol", ownerId: 0, x: 0, y: 0 },
      { kind: "hit", target: "ped", ownerId: 0, x: 1, y: 1 },
      { kind: "pickup", pickupKind: "health", playerId: 0, x: 2, y: 2 },
      { kind: "explosion", x: 3, y: 3 },
    ]);
    expect(context.sources).toHaveLength(0);
    expect(context.oscillators).toHaveLength(5);
  });

  it("runs the engine from the clip when it has one: faster is higher, and stopping stops it", () => {
    const { context, factory } = createFakeAudioContext();
    const loop = { setRate: vi.fn(), stop: vi.fn() };
    const player = { ...playerWith(["engine"]), startLoop: vi.fn(() => loop) };
    const sound = createArenaSound(factory, true, () => player);
    sound.updateEngine(0, true);
    sound.updateEngine(20, true);
    expect(player.startLoop).toHaveBeenCalledTimes(1);
    expect(loop.setRate).toHaveBeenLastCalledWith(engineRate(20));
    expect(engineRate(20)).toBeGreaterThan(engineRate(0));
    expect(context.oscillators).toHaveLength(0);
    sound.updateEngine(20, false);
    expect(loop.stop).toHaveBeenCalledTimes(1);
    sound.updateEngine(5, true);
    expect(player.startLoop).toHaveBeenCalledTimes(2);
    sound.dispose();
    expect(loop.stop).toHaveBeenCalledTimes(2);
  });

  it("runs the siren loop once while a chase is near and stops it when it is not", () => {
    const { context, factory } = createFakeAudioContext();
    const loop = { setRate: vi.fn(), stop: vi.fn() };
    const player = { ...playerWith(["siren"]), startLoop: vi.fn(() => loop) };
    const sound = createArenaSound(factory, true, () => player);
    sound.updateSiren(true);
    sound.updateSiren(true);
    expect(player.startLoop).toHaveBeenCalledTimes(1);
    expect(player.startLoop).toHaveBeenCalledWith("siren");
    sound.updateSiren(false);
    expect(loop.stop).toHaveBeenCalledTimes(1);
    sound.updateSiren(true);
    sound.dispose();
    expect(loop.stop).toHaveBeenCalledTimes(2);
    expect(context.oscillators).toHaveLength(0);
  });

  it("keeps the siren silent while sound is off and without its clip", () => {
    const { factory } = createFakeAudioContext();
    const loop = { setRate: vi.fn(), stop: vi.fn() };
    const player = { ...playerWith(["siren"]), startLoop: vi.fn(() => loop) };
    const sound = createArenaSound(factory, false, () => player);
    sound.updateSiren(true);
    expect(player.startLoop).not.toHaveBeenCalled();
    sound.setEnabled(true);
    sound.updateSiren(true);
    expect(player.startLoop).toHaveBeenCalledTimes(1);
    sound.setEnabled(false);
    sound.updateSiren(true);
    expect(loop.stop).toHaveBeenCalledTimes(1);
    const mute = createArenaSound(factory, true, () => playerWith(["engine"]));
    mute.updateSiren(true);
    expect(player.startLoop).toHaveBeenCalledTimes(1);
  });

  it("keeps the oscillator drone when there is no engine clip", () => {
    const { context, factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => playerWith(["pistol"]));
    sound.updateEngine(4, true);
    expect(context.oscillators).toHaveLength(1);
  });

  it("stops the drone once the engine clip has landed mid-drive", () => {
    // The clips arrive whenever the preload finishes; a car already running on the drone must
    // hand over to the clip rather than play both.
    const { context, factory } = createFakeAudioContext();
    const loop = { setRate: vi.fn(), stop: vi.fn() };
    let landed = false;
    const player: SamplePlayer = {
      preload: vi.fn(async () => undefined),
      play: vi.fn(() => false),
      startLoop: vi.fn(() => loop),
      has: () => landed,
    };
    const sound = createArenaSound(factory, true, () => player);
    sound.updateEngine(4, true);
    expect(context.oscillators).toHaveLength(1);
    landed = true;
    sound.updateEngine(6, true);
    expect(context.oscillators[0]!.stopped).toBe(true);
    expect(player.startLoop).toHaveBeenCalledTimes(1);
    expect(loop.setRate).toHaveBeenLastCalledWith(engineRate(6));
  });
});

describe("engineRate", () => {
  it("idles at rest, tops out at the top speed, and never goes past it", () => {
    expect(engineRate(0)).toBe(ENGINE_RATE_MIN);
    expect(engineRate(ENGINE_RATE_TOP_SPEED_MPS)).toBe(ENGINE_RATE_MAX);
    expect(engineRate(ENGINE_RATE_TOP_SPEED_MPS * 2)).toBe(ENGINE_RATE_MAX);
    expect(engineRate(-3)).toBe(ENGINE_RATE_MIN);
  });

  it("hands the gesture, the toggle, the car and the loud events to the radio", () => {
    const { factory } = createFakeAudioContext();
    const radio: RadioPlayer = {
      unlock: vi.fn(),
      setInCar: vi.fn(),
      setEnabled: vi.fn(),
      setSoundEnabled: vi.fn(),
      tune: vi.fn(() => null),
      nextStation: vi.fn(() => null),
      station: () => null,
      playing: () => true,
      duck: vi.fn(),
      dispose: vi.fn(),
    };
    const sound = createArenaSound(factory, true, undefined, () => radio);
    expect(sound.radio).toBe(radio);
    sound.unlock();
    sound.unlock();
    expect(radio.unlock).toHaveBeenCalledTimes(2);
    sound.setEnabled(false);
    expect(radio.setSoundEnabled).toHaveBeenLastCalledWith(false);
    sound.setEnabled(true);
    sound.updateEngine(3, true);
    expect(radio.setInCar).toHaveBeenLastCalledWith(true);
    sound.updateEngine(0, false);
    expect(radio.setInCar).toHaveBeenLastCalledWith(false);
    sound.handleEvents([
      { kind: "shot", weapon: "pistol", ownerId: 0, x: 0, y: 0 },
      { kind: "pickup", pickupKind: "health", playerId: 0, x: 2, y: 2 },
      { kind: "explosion", x: 3, y: 3 },
    ]);
    expect(radio.duck).toHaveBeenCalledTimes(2);
    sound.dispose();
    expect(radio.dispose).toHaveBeenCalledTimes(1);
  });
});
