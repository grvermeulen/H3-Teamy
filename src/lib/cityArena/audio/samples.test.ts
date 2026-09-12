import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { AUDIO_CLIPS, CLIP_NAMES, clipUrl, type ClipName } from "./clips";
import { browserSamplePlayer, createSamplePlayer } from "./samples";
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
