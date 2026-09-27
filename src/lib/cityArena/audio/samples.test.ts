import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { AUDIO_CLIPS, CLIP_NAMES, clipUrl, type ClipName } from "./clips";
import {
  MAX_ONE_SHOTS,
  browserSamplePlayer,
  createSamplePlayer,
} from "./samples";
import type { SpatialMix } from "./spatial";
import { createFakeAudioContext } from "./testing/fakeAudioContext";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

/** A fetch that has none of the clips. */
function notFound(): typeof fetch {
  return vi.fn(
    async () => new Response(null, { status: 404 }),
  ) as unknown as typeof fetch;
}

/**
 * A fetch that serves the named clips and 404s the rest. A clip listed as `broken` is served as
 * an empty body, which the fake context refuses to decode.
 */
function serving(clips: ClipName[], broken: ClipName[] = []): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const clip = CLIP_NAMES.find((name) => clipUrl(name) === url);
    if (clip && broken.includes(clip))
      return new Response(new ArrayBuffer(0), { status: 200 });
    if (clip && clips.includes(clip))
      return new Response(new ArrayBuffer(8), { status: 200 });
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
}

describe("createSamplePlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports every clip missing before anything decodes, so the synth keeps the sound", () => {
    const { context } = createFakeAudioContext();
    const player = createSamplePlayer(context, context.destination, notFound());
    expect(player.has("pistol")).toBe(false);
    expect(player.play("pistol")).toBe(false);
    expect(player.startLoop("engine")).toBeNull();
    expect(context.sources).toHaveLength(0);
  });

  it("plays a decoded clip once, at the clip's level, into the destination it was given", async () => {
    const { context } = createFakeAudioContext();
    const player = createSamplePlayer(
      context,
      context.destination,
      serving(["pistol"]),
    );
    await player.preload();
    expect(player.has("pistol")).toBe(true);
    expect(player.play("pistol")).toBe(true);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]!.started).toBe(true);
    expect(context.sources[0]!.loop).toBe(false);
    expect(context.gains.at(-1)!.gain.value).toBe(AUDIO_CLIPS.pistol.gain);
  });

  it("boosts a cannon sample without changing later explosion playback", async () => {
    const { context } = createFakeAudioContext();
    const player = createSamplePlayer(
      context,
      context.destination,
      serving(["explosion"]),
    );
    await player.preload();
    player.play("explosion", 1, 1.25);
    expect(context.gains.at(-1)!.gain.value).toBe(1);
    player.play("explosion");
    expect(context.gains.at(-1)!.gain.value).toBe(0.8);
  });

  it("plays at the rate it is given", async () => {
    const { context } = createFakeAudioContext();
    const player = createSamplePlayer(
      context,
      context.destination,
      serving(["pistol"]),
    );
    await player.preload();
    player.play("pistol", 1.2);
    expect(context.sources[0]!.playbackRate.value).toBe(1.2);
  });

  it("leaves out a clip the server does not have without troubling Sentry", async () => {
    const { context } = createFakeAudioContext();
    const player = createSamplePlayer(context, context.destination, notFound());
    await player.preload();
    expect(CLIP_NAMES.some((clip) => player.has(clip))).toBe(false);
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("reports a clip that will not decode once, and keeps the rest", async () => {
    const { context } = createFakeAudioContext();
    const player = createSamplePlayer(
      context,
      context.destination,
      serving(["pistol", "uzi"], ["uzi"]),
    );
    await player.preload();
    expect(player.has("pistol")).toBe(true);
    expect(player.has("uzi")).toBe(false);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      { tags: { area: "arena", kind: "audio", clip: "uzi" } },
    );
  });

  it("fetches every clip once, however often it is asked to preload", async () => {
    const { context } = createFakeAudioContext();
    const fetchImpl = serving(["pistol"]);
    const player = createSamplePlayer(context, context.destination, fetchImpl);
    await Promise.all([player.preload(), player.preload()]);
    await player.preload();
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(CLIP_NAMES.length);
  });

  it("loops a looping clip until told to stop, following the rate it is given", async () => {
    const { context } = createFakeAudioContext();
    const player = createSamplePlayer(
      context,
      context.destination,
      serving(["engine"]),
    );
    await player.preload();
    const loop = player.startLoop("engine");
    expect(loop).not.toBeNull();
    const source = context.sources[0]!;
    expect(source.loop).toBe(true);
    loop!.setRate(1.5);
    expect(source.playbackRate.value).toBe(1.5);
    expect(source.operations.at(-1)).toMatchObject({
      kind: "ramp",
      value: 1.5,
    });
    loop!.stop();
    expect(source.stopped).toBe(true);
  });
});

describe("browserSamplePlayer", () => {
  it("declines a context that cannot play buffers, so the synth is all there is", () => {
    const { context } = createFakeAudioContext();
    const synthOnly = {
      currentTime: 0,
      destination: context.destination,
      createGain: context.createGain,
      createOscillator: context.createOscillator,
      resume: () => undefined,
    };
    expect(browserSamplePlayer(synthOnly, context.destination)).toBeNull();
    expect(browserSamplePlayer(context, context.destination)).not.toBeNull();
  });
});

describe("placed voices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const placed: SpatialMix = { gain: 0.5, pan: 0.4, cutoffHz: 6000 };

  /** A player over a fresh fake context that has loaded `clips`. */
  async function loaded(
    clips: ClipName[],
    options?: { spatial?: boolean },
  ): Promise<{
    context: ReturnType<typeof createFakeAudioContext>["context"];
    player: ReturnType<typeof createSamplePlayer>;
  }> {
    const { context } = createFakeAudioContext(options);
    const player = createSamplePlayer(
      context,
      context.destination,
      serving(clips),
    );
    await player.preload();
    return { context, player };
  }

  it("plays a placed clip through gain, low-pass and panner at the mix it is given", async () => {
    const { context, player } = await loaded(["pistol"]);
    expect(player.play("pistol", 1, 1, placed)).toBe(true);
    expect(context.gains.at(-1)!.gain.value).toBeCloseTo(
      AUDIO_CLIPS.pistol.gain * placed.gain,
    );
    expect(context.filters[0]!.type).toBe("lowpass");
    expect(context.filters[0]!.frequency.value).toBe(placed.cutoffHz);
    expect(context.panners[0]!.pan.value).toBe(placed.pan);
  });

  it("still plays a placed clip, unpanned, in a context without panners or filters", async () => {
    const { context, player } = await loaded(["pistol"], { spatial: false });
    expect(player.play("pistol", 1, 1, placed)).toBe(true);
    expect(context.sources[0]!.started).toBe(true);
    expect(context.gains.at(-1)!.gain.value).toBeCloseTo(
      AUDIO_CLIPS.pistol.gain * placed.gain,
    );
  });

  it("moves a placed loop by easing its gain, cutoff and pan", async () => {
    const { context, player } = await loaded(["engine"]);
    const loop = player.startLoop("engine", placed)!;
    loop.setPlacement({ gain: 0.2, pan: -0.6, cutoffHz: 3000 });
    const gain = context.gains.at(-1)!;
    expect(gain.operations.at(-1)).toMatchObject({
      kind: "target",
      value: AUDIO_CLIPS.engine.gain * 0.2,
    });
    expect(context.panners[0]!.operations.at(-1)).toMatchObject({
      kind: "target",
      value: -0.6,
    });
    expect(context.filters[0]!.operations.at(-1)).toMatchObject({
      kind: "target",
      value: 3000,
    });
  });

  it("turns the 25th simultaneous voice away without handing the sound back to the synth", async () => {
    const { context, player } = await loaded(["pistol"]);
    for (let voice = 0; voice < MAX_ONE_SHOTS; voice++)
      player.play("pistol", 1, 1, placed);
    expect(player.liveVoices()).toBe(MAX_ONE_SHOTS);
    expect(player.play("pistol", 1, 1, placed)).toBe(true);
    expect(context.sources).toHaveLength(MAX_ONE_SHOTS);
  });

  it("lets a louder voice cut the quietest short when every voice is busy", async () => {
    const { context, player } = await loaded(["pistol"]);
    player.play("pistol", 1, 1, { ...placed, gain: 0.1 });
    for (let voice = 1; voice < MAX_ONE_SHOTS; voice++)
      player.play("pistol", 1, 1, placed);
    player.play("pistol", 1, 1, { ...placed, gain: 0.9 });
    expect(context.sources).toHaveLength(MAX_ONE_SHOTS + 1);
    expect(context.sources[0]!.stopped).toBe(true);
    expect(player.liveVoices()).toBe(MAX_ONE_SHOTS);
  });

  it("frees the voices once their clips have ended", async () => {
    const { context, player } = await loaded(["pistol"]);
    for (let voice = 0; voice < MAX_ONE_SHOTS; voice++) player.play("pistol");
    context.currentTime += 2;
    expect(player.liveVoices()).toBe(0);
    player.play("pistol");
    expect(context.sources).toHaveLength(MAX_ONE_SHOTS + 1);
  });
});
