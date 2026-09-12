import * as Sentry from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAudioContext } from "../testing/fakeAudioContext";
import { createFakeMediaElement } from "../testing/fakeMediaElement";
import { DUCK_LEVEL, RADIO_GAIN, createRadio } from "./radio";
import type { RadioStation } from "./stations";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const DIAL: RadioStation[] = [
  {
    id: "a",
    name: "A FM",
    tracks: [
      { file: "a-1-00000000.mp3", title: "Een", seconds: 120 },
      { file: "a-2-00000000.mp3", title: "Twee", seconds: 120 },
    ],
  },
  {
    id: "b",
    name: "B FM",
    tracks: [{ file: "b-1-00000000.mp3", title: "Drie", seconds: 120 }],
  },
];

/** A radio over fakes; the gain node is the last one the context created. */
function setup(
  overrides: {
    stations?: RadioStation[];
    stationId?: string;
    enabled?: boolean;
  } = {},
) {
  const { context } = createFakeAudioContext();
  const element = createFakeMediaElement();
  const radio = createRadio({
    context,
    destination: context.destination,
    element,
    source: context.createMediaElementSource({} as HTMLMediaElement),
    stations: overrides.stations ?? DIAL,
    stationId: overrides.stationId,
    enabled: overrides.enabled ?? true,
  });
  const gain = context.gains[context.gains.length - 1];
  return { context, element, radio, gain };
}

/** Lets the play promises settle. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("createRadio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("plays the tuned station's first track in a car and pauses, keeping the position, on the way out", async () => {
    const { element, radio, gain } = setup({ stationId: "b" });
    expect(radio.station()?.id).toBe("b");
    expect(radio.playing()).toBe(false);
    radio.setInCar(true);
    await flush();
    expect(element.src).toBe("/arena/radio/tracks/b-1-00000000.mp3");
    expect(element.paused).toBe(false);
    expect(gain.gain.value).toBe(RADIO_GAIN);
    expect(radio.playing()).toBe(true);
    element.currentTime = 42;
    radio.setInCar(false);
    expect(element.paused).toBe(true);
    expect(gain.gain.value).toBe(0);
    radio.setInCar(true);
    await flush();
    expect(element.currentTime).toBe(42);
    expect(element.src).toBe("/arena/radio/tracks/b-1-00000000.mp3");
  });

  it("moves to the next track when one ends, and wraps", async () => {
    const { element, radio } = setup({ stationId: "a" });
    radio.setInCar(true);
    await flush();
    element.end();
    await flush();
    expect(element.src).toBe("/arena/radio/tracks/a-2-00000000.mp3");
    expect(element.paused).toBe(false);
    element.end();
    await flush();
    expect(element.src).toBe("/arena/radio/tracks/a-1-00000000.mp3");
  });

  it("cycles the dial from the top of the new station and tunes by id", async () => {
    const { element, radio } = setup();
    radio.setInCar(true);
    await flush();
    element.currentTime = 30;
    expect(radio.nextStation()?.id).toBe("b");
    await flush();
    expect(element.src).toBe("/arena/radio/tracks/b-1-00000000.mp3");
    expect(element.currentTime).toBe(0);
    expect(radio.nextStation()?.id).toBe("a");
    expect(radio.tune("b")?.id).toBe("b");
    expect(radio.tune("b")?.id).toBe("b");
    expect(radio.tune("nope")?.id).toBe("a");
  });

  it("is silent with Radio off or Geluid off, and loads nothing while off", async () => {
    const { element, radio } = setup({ enabled: false });
    radio.setInCar(true);
    await flush();
    expect(element.src).toBe("");
    expect(element.playCalls).toBe(0);
    radio.setEnabled(true);
    await flush();
    expect(element.paused).toBe(false);
    radio.setSoundEnabled(false);
    expect(element.paused).toBe(true);
    expect(radio.playing()).toBe(false);
    radio.setSoundEnabled(true);
    await flush();
    expect(element.paused).toBe(false);
  });

  it("primes the element silently on unlock and retries a play the browser refused", async () => {
    const { element, radio, gain } = setup();
    radio.unlock();
    await flush();
    expect(element.playCalls).toBe(1);
    expect(element.paused).toBe(true);
    expect(gain.gain.value).toBe(0);
    const refused = new Error("gesture needed");
    refused.name = "NotAllowedError";
    element.refuseWith = refused;
    radio.setInCar(true);
    await flush();
    expect(element.paused).toBe(true);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    radio.unlock();
    await flush();
    expect(element.paused).toBe(false);
    // Nothing refused: a later gesture leaves the element alone.
    const playsSoFar = element.playCalls;
    radio.unlock();
    await flush();
    expect(element.playCalls).toBe(playsSoFar);
  });

  it("reports a play that fails for another reason, once, and swallows an interrupted start", async () => {
    const { element, radio } = setup();
    element.refuseWith = new Error("decode");
    radio.setInCar(true);
    await flush();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const aborted = new Error("interrupted");
    aborted.name = "AbortError";
    element.refuseWith = aborted;
    radio.setInCar(false);
    radio.setInCar(true);
    await flush();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("reports a priming that fails for another reason, tagged as such", async () => {
    const { element, radio } = setup();
    element.refuseWith = new Error("decode");
    radio.unlock();
    await flush();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { area: "arena", kind: "radio-prime" } }),
    );
  });

  it("ducks under a loud effect and ramps back, and not while silent", async () => {
    const { radio, gain } = setup();
    radio.duck();
    expect(gain.operations.filter((op) => op.kind === "ramp")).toHaveLength(0);
    radio.setInCar(true);
    await flush();
    radio.duck();
    const ops = gain.operations.filter(
      (op) => op.kind === "set" || op.kind === "ramp",
    );
    expect(ops.at(-2)).toMatchObject({
      kind: "set",
      value: RADIO_GAIN * DUCK_LEVEL,
    });
    expect(ops.at(-1)).toMatchObject({ kind: "ramp", value: RADIO_GAIN });
  });

  it("does nothing without a dial", async () => {
    const { element, radio } = setup({ stations: [] });
    radio.unlock();
    radio.setInCar(true);
    await flush();
    expect(radio.station()).toBeNull();
    expect(radio.nextStation()).toBeNull();
    expect(radio.playing()).toBe(false);
    expect(element.playCalls).toBe(0);
  });

  it("disposes: pauses, disconnects and ignores later calls", async () => {
    const { element, radio, gain } = setup();
    radio.setInCar(true);
    await flush();
    radio.dispose();
    expect(element.paused).toBe(true);
    expect(gain.operations.some((op) => op.kind === "disconnect")).toBe(true);
    radio.setInCar(true);
    radio.unlock();
    await flush();
    expect(element.playCalls).toBe(1);
  });
});
