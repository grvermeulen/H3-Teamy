import * as Sentry from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArenaEvent } from "../sim/types";
import type { ClipName } from "./clips";
import type { RadioPlayer } from "./radio/radio";
import {
  createSamplePlayer,
  type LoopHandle,
  type SamplePlayer,
} from "./samples";
import { listenerAt, type SpatialMix } from "./spatial";
import { createFakeAudioContext } from "./testing/fakeAudioContext";
import { CHATTER_CLIPS } from "./spotSounds";
import type { TrafficSource } from "./trafficVoices";
import {
  ENGINE_RATE_MAX,
  ENGINE_RATE_MIN,
  ENGINE_RATE_TOP_SPEED_MPS,
  FOOTSTEP_RATE_JITTER,
  createArenaSound,
  engineRate,
  type ArenaSound,
} from "./sound";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

/** A sample player that has exactly the clips named, and remembers what it was asked to play. */
function playerWith(clips: ClipName[]): SamplePlayer {
  return {
    preload: vi.fn(async () => undefined),
    play: vi.fn((clip: ClipName) => clips.includes(clip)),
    startLoop: vi.fn(() => null),
    liveVoices: () => 0,
    has: (clip: ClipName) => clips.includes(clip),
  };
}

/** A radio that does nothing, for tests that only watch one of its controls. */
function silentRadio(): RadioPlayer {
  return {
    unlock: vi.fn(),
    setInCar: vi.fn(),
    setEnabled: vi.fn(),
    setSoundEnabled: vi.fn(),
    tune: vi.fn(() => null),
    nextStation: vi.fn(() => null),
    station: () => null,
    playing: () => false,
    duck: vi.fn(),
    dispose: vi.fn(),
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
    expect(player.play).toHaveBeenCalledWith("explosion", 1, 1.25, undefined);
    sound.handleEvents([{ kind: "explosion", x: 0, y: 0 }]);
    expect(player.play).toHaveBeenLastCalledWith("explosion", 1, 1, undefined);
    const { context, factory: bare } = createFakeAudioContext();
    const silent = createArenaSound(bare, true, () => playerWith([]));
    silent.unlock();
    silent.handleEvents([
      { kind: "shot", weapon: "cannon", ownerId: 0, x: 0, y: 0 },
    ]);
    expect(context.oscillators).toHaveLength(1);
  });

  it("voices a building collapse with the explosion clip, and the same fallback tone", () => {
    const player = playerWith(["explosion"]);
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.unlock();
    sound.handleEvents([
      { kind: "collapse", structureId: 1, x: 0, y: 0, killerId: null },
    ]);
    expect(player.play).toHaveBeenCalledWith("explosion", 1, 1, undefined);
    const { context, factory: bare } = createFakeAudioContext();
    const silent = createArenaSound(bare, true, () => playerWith([]));
    silent.unlock();
    silent.handleEvents([
      { kind: "collapse", structureId: 1, x: 0, y: 0, killerId: null },
    ]);
    expect(context.oscillators).toHaveLength(1);
  });

  it("launches a rocket with a falling whoosh, never the explosion clip, even when it has loaded", () => {
    const player = playerWith(["explosion", "shotgun", "pistol"]);
    const { context, factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.unlock();
    sound.handleEvents([
      { kind: "shot", weapon: "rocket", ownerId: 0, x: 0, y: 0 },
    ]);
    expect(player.play).not.toHaveBeenCalled();
    expect(context.oscillators).toHaveLength(1);
    const [start, ramp] = context.oscillators[0].operations.filter(
      (operation) => operation.kind === "set" || operation.kind === "ramp",
    );
    expect(ramp).toMatchObject({ kind: "ramp" });
    expect(ramp.value).toBeLessThan(start.value!);
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
    const loop = { setRate: vi.fn(), setPlacement: vi.fn(), stop: vi.fn() };
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
    const loop = { setRate: vi.fn(), setPlacement: vi.fn(), stop: vi.fn() };
    let landed = false;
    const player: SamplePlayer = {
      preload: vi.fn(async () => undefined),
      play: vi.fn(() => false),
      startLoop: vi.fn(() => loop),
      has: () => landed,
      liveVoices: () => 0,
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

describe("placing sounds around the listener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const northUp = listenerAt(0, 0, null);

  /** The placement the player was handed for its `index`th play. */
  function placementOf(player: SamplePlayer, index: number): SpatialMix {
    return vi.mocked(player.play).mock.calls[index]![3]!;
  }

  it("plays a far shot quieter than a near one", () => {
    const player = playerWith(["pistol"]);
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.setListener(northUp);
    sound.handleEvents([
      { kind: "shot", weapon: "pistol", ownerId: 1, x: 0, y: -10 },
      { kind: "shot", weapon: "pistol", ownerId: 1, x: 0, y: -100 },
    ]);
    expect(placementOf(player, 1).gain).toBeLessThan(
      placementOf(player, 0).gain,
    );
    expect(placementOf(player, 1).cutoffHz).toBeLessThan(
      placementOf(player, 0).cutoffHz,
    );
  });

  it("pans a shot east of a north-up 2D listener to the right, synthesised or not", () => {
    const player = playerWith(["pistol"]);
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.setListener(northUp);
    sound.handleEvents([
      { kind: "shot", weapon: "pistol", ownerId: 1, x: 40, y: 0 },
    ]);
    expect(placementOf(player, 0).pan).toBeGreaterThan(0.5);
    const { context, factory: bare } = createFakeAudioContext();
    const synth = createArenaSound(bare, true);
    synth.setListener(northUp);
    synth.handleEvents([
      { kind: "hit", target: "ped", ownerId: 1, x: 20, y: 0 },
    ]);
    expect(context.panners).toHaveLength(1);
    expect(context.panners[0]!.pan.value).toBeGreaterThan(0.5);
  });

  it("disconnects a synthesised voice's nodes once its tone has ended", () => {
    const { context, factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true);
    sound.setListener(northUp);
    sound.handleEvents([
      { kind: "hit", target: "ped", ownerId: 1, x: 20, y: 0 },
    ]);
    const oscillator = context.oscillators[0]!;
    const nodes = [
      context.gains.at(-1)!,
      context.filters[0]!,
      context.panners[0]!,
    ];
    oscillator.onended?.();
    expect(oscillator.operations).toContainEqual({ kind: "disconnect" });
    for (const node of nodes)
      expect(node.operations).toContainEqual({ kind: "disconnect" });
  });

  it("plays nothing at all for a shot past its reach", () => {
    const player = playerWith(["pistol"]);
    const { context, factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.setListener(northUp);
    sound.handleEvents([
      { kind: "shot", weapon: "pistol", ownerId: 1, x: 0, y: -400 },
      { kind: "shot", weapon: "uzi", ownerId: 1, x: 0, y: -400 },
    ]);
    expect(player.play).not.toHaveBeenCalled();
    expect(context.oscillators).toHaveLength(0);
  });

  it("places an impact at its car, and plays it unplaced when the car is unknown", () => {
    const player = playerWith(["impact"]);
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.setListener(northUp);
    const impact: ArenaEvent = {
      kind: "impact",
      vehicleId: 7,
      otherVehicleId: null,
      impactSpeed: 9,
    };
    sound.handleEvents([impact], {
      selfId: 0,
      vehicleAt: (id) => (id === 7 ? { x: -30, y: 0 } : null),
    });
    expect(placementOf(player, 0).pan).toBeLessThan(-0.5);
    sound.handleEvents([impact], { selfId: 0, vehicleAt: () => null });
    expect(vi.mocked(player.play).mock.calls[1]![3]).toBeUndefined();
  });

  it("ducks the radio for a shot close by but not for a faint one far off", () => {
    const { factory } = createFakeAudioContext();
    const duck = vi.fn();
    const radio = { ...silentRadio(), duck };
    const sound = createArenaSound(factory, true, undefined, () => radio);
    sound.setListener(northUp);
    sound.handleEvents([
      { kind: "shot", weapon: "pistol", ownerId: 1, x: 0, y: -120 },
    ]);
    expect(duck).not.toHaveBeenCalled();
    sound.handleEvents([
      { kind: "shot", weapon: "pistol", ownerId: 1, x: 0, y: -5 },
    ]);
    expect(duck).toHaveBeenCalledTimes(1);
  });
});

describe("the local player's own sounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** The clips a player was asked to play, in order. */
  function played(player: SamplePlayer): ClipName[] {
    return vi.mocked(player.play).mock.calls.map(([clip]) => clip);
  }

  it("plays footsteps at the walking cadence, a little detuned, and none in a car", () => {
    const player = playerWith(["footstep"]);
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(
      factory,
      true,
      () => player,
      undefined,
      () => 1,
    );
    for (let tick = 0; tick <= 20; tick++)
      sound.updateSelf({ tick, onFoot: true, speedMps: 1.4, car: null });
    expect(played(player)).toEqual(["footstep"]);
    expect(vi.mocked(player.play).mock.calls[0]![1]).toBeCloseTo(
      1 + FOOTSTEP_RATE_JITTER,
    );
    for (let tick = 21; tick <= 120; tick++)
      sound.updateSelf({
        tick,
        onFoot: false,
        speedMps: 0,
        car: { forwardMps: 12, heading: 0 },
      });
    expect(played(player)).toEqual(["footstep"]);
  });

  it("squeals once when the car turns hard", () => {
    const player = playerWith(["skid"]);
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    for (let tick = 0; tick < 10; tick++)
      sound.updateSelf({
        tick,
        onFoot: false,
        speedMps: 0,
        car: { forwardMps: 20, heading: tick * 0.08 },
      });
    expect(played(player)).toEqual(["skid"]);
  });

  it("plays the death sting for this player's own death only", () => {
    const player = playerWith(["death"]);
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    const sources = { selfId: 2, vehicleAt: () => null };
    sound.handleEvents(
      [
        {
          kind: "kill",
          victim: "player",
          victimId: 5,
          killerId: 2,
          x: 0,
          y: 0,
        },
        { kind: "kill", victim: "ped", victimId: 2, killerId: 5, x: 0, y: 0 },
      ],
      sources,
    );
    expect(player.play).not.toHaveBeenCalled();
    sound.handleEvents(
      [
        {
          kind: "kill",
          victim: "player",
          victimId: 2,
          killerId: 5,
          x: 9,
          y: 9,
        },
      ],
      sources,
    );
    expect(played(player)).toEqual(["death"]);
  });
});

describe("the city's loops", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** A player with the engine and siren clips whose loops are spies, one per start. */
  function loopingPlayer(): {
    player: SamplePlayer;
    loops: { clip: ClipName; loop: LoopHandle }[];
  } {
    const loops: { clip: ClipName; loop: LoopHandle }[] = [];
    const player: SamplePlayer = {
      ...playerWith(["engine", "siren"]),
      startLoop: vi.fn((clip: ClipName) => {
        const loop = { setRate: vi.fn(), setPlacement: vi.fn(), stop: vi.fn() };
        loops.push({ clip, loop });
        return loop;
      }),
    };
    return { player, loops };
  }

  /** A frame of a world with only `traffic` in it: no people, no map. */
  function streetWith(
    traffic: TrafficSource[],
    dt = 0.016,
  ): Parameters<ArenaSound["updateWorld"]>[0] {
    return { dt, traffic, peds: [], walkers: [], tiles: [], landmarks: [] };
  }

  /** A car `id` at (`x`, `y`) moving at `speedMps`. */
  function car(
    id: number,
    x: number,
    y: number,
    speedMps = 10,
    siren = false,
  ): TrafficSource {
    return { id, x, y, speedMps, siren };
  }

  it("runs an engine on each nearby moving car, placed where it drives, and none on a parked one", () => {
    const { player, loops } = loopingPlayer();
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.setListener(listenerAt(0, 0, null));
    sound.updateWorld(
      streetWith([car(1, 20, 0), car(2, -20, 0), car(3, 5, 0, 0)]),
    );
    expect(loops.map(({ clip }) => clip)).toEqual(["engine", "engine"]);
    const [right, left] = vi
      .mocked(player.startLoop)
      .mock.calls.map(([, placement]) => placement!);
    expect(right!.pan).toBeGreaterThan(0);
    expect(left!.pan).toBeLessThan(0);
    expect(loops[0]!.loop.setRate).toHaveBeenCalledWith(engineRate(10));
    expect(sound.debug().world.engines).toEqual([1, 2, null, null]);
  });

  it("sounds the siren on the police cars only, and stops every loop when sound goes off", () => {
    const { player, loops } = loopingPlayer();
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.setListener(listenerAt(0, 0, null));
    const traffic = [car(1, 0, -30, 10, true), car(2, 0, 30)];
    sound.updateWorld(streetWith(traffic));
    expect(sound.debug().world.sirens).toEqual([1, null]);
    expect(loops.filter(({ clip }) => clip === "siren")).toHaveLength(1);
    sound.setEnabled(false);
    sound.updateWorld(streetWith(traffic));
    expect(
      loops.every(({ loop }) => vi.mocked(loop.stop).mock.calls.length === 1),
    ).toBe(true);
  });

  it("reports a world update that throws, and never throws into the game loop", () => {
    const player: SamplePlayer = {
      ...playerWith(["engine"]),
      startLoop: vi.fn(() => {
        throw new Error("no loops today");
      }),
    };
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.setListener(listenerAt(0, 0, null));
    expect(() => sound.updateWorld(streetWith([car(1, 20, 0)]))).not.toThrow();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      { tags: { area: "arena", kind: "audio-world" } },
    );
  });

  it("fades a car's engine out once it drives out of earshot, then stops it", () => {
    const { player, loops } = loopingPlayer();
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.setListener(listenerAt(0, 0, null));
    sound.updateWorld(streetWith([car(1, 20, 0)], 0.1));
    const loop = loops[0]!.loop;
    sound.updateWorld(streetWith([car(1, 400, 0)], 0.1));
    expect(vi.mocked(loop.setPlacement).mock.lastCall![0].gain).toBe(0);
    expect(loop.stop).not.toHaveBeenCalled();
    for (let frame = 0; frame < 40; frame++)
      sound.updateWorld(streetWith([car(1, 400, 0)], 0.1));
    expect(loop.stop).toHaveBeenCalledTimes(1);
  });
});

describe("the street around the listener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("murmurs from someone walking by, placed on them, and steps where they walk", () => {
    const player = playerWith([...CHATTER_CLIPS, "footstep"]);
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.setListener(listenerAt(0, 0, null));
    const walker = { x: 4, y: 0 };
    for (let frame = 0; frame < 100; frame++)
      sound.updateWorld({
        dt: 0.1,
        traffic: [],
        peds: [walker],
        walkers: [walker],
        tiles: [],
        landmarks: [],
      });
    const calls = vi.mocked(player.play).mock.calls;
    const chatter = calls.filter(([clip]) => CHATTER_CLIPS.includes(clip));
    expect(chatter.length).toBeGreaterThanOrEqual(1);
    expect(chatter[0]![3]!.pan).toBeGreaterThan(0);
    expect(calls.some(([clip]) => clip === "footstep")).toBe(true);
    expect(sound.debug().world.spots[0]).toMatchObject({
      kind: "chatter",
      x: 4,
    });
  });
});

describe("Omgevingsgeluid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("silences the chatter and the passers-by when off, and brings them back when on", () => {
    const player = playerWith([...CHATTER_CLIPS, "footstep"]);
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.setListener(listenerAt(0, 0, null));
    sound.setAmbienceEnabled(false);
    const frame = {
      dt: 0.1,
      traffic: [],
      peds: [{ x: 3, y: 0 }],
      walkers: [{ x: 3, y: 0 }],
      tiles: [],
      landmarks: [],
    };
    for (let tick = 0; tick < 100; tick++) sound.updateWorld(frame);
    expect(player.play).not.toHaveBeenCalled();
    expect(sound.debug().ambience).toBe(false);
    sound.setAmbienceEnabled(true);
    for (let tick = 0; tick < 100; tick++) sound.updateWorld(frame);
    expect(player.play).toHaveBeenCalled();
  });

  it("keeps the traffic and the events, which are not ambience", () => {
    const player = playerWith(["pistol"]);
    const { factory } = createFakeAudioContext();
    const sound = createArenaSound(factory, true, () => player);
    sound.setAmbienceEnabled(false);
    sound.handleEvents([
      { kind: "shot", weapon: "pistol", ownerId: 0, x: 0, y: 0 },
    ]);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(sound.debug().recent).toEqual([{ kind: "shot", mix: null }]);
  });
});
