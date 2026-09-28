import { describe, expect, it } from "vitest";
import type { Listener } from "./spatial";
import {
  ENGINE_VOICES,
  VOICE_SWAP_MARGIN_M,
  assignVoices,
  type TrafficSource,
} from "./trafficVoices";

const listener: Listener = { x: 0, y: 0, facing: 0 };
const anyCar = (): boolean => true;

/** A moving car `id` at (`x`, 0). */
function car(id: number, x: number, siren = false): TrafficSource {
  return { id, x, y: 0, speedMps: 10, siren };
}

const NONE: (number | null)[] = [null, null, null, null];

describe("assignVoices", () => {
  it("gives the voices to the nearest cars, nearest first", () => {
    const cars = [car(1, 50), car(2, 10), car(3, 80), car(4, 20), car(5, 30)];
    expect(assignVoices(NONE, cars, listener, ENGINE_VOICES, anyCar)).toEqual([
      2, 4, 5, 1,
    ]);
  });

  it("keeps every car on its voice when the order among them jitters", () => {
    const first = assignVoices(
      NONE,
      [car(1, 10), car(2, 20), car(3, 30)],
      listener,
      ENGINE_VOICES,
      anyCar,
    );
    const jittered = assignVoices(
      first,
      [car(1, 31), car(2, 19), car(3, 12)],
      listener,
      ENGINE_VOICES,
      anyCar,
    );
    expect(jittered).toEqual(first);
  });

  it("holds a voice against an outsider that is only slightly nearer", () => {
    const held = [1, 2, 3, 4];
    const cars = [car(1, 10), car(2, 20), car(3, 30), car(4, 40)];
    const nudged = [...cars, car(5, 40 - VOICE_SWAP_MARGIN_M / 2)];
    expect(assignVoices(held, nudged, listener, ENGINE_VOICES, anyCar)).toEqual(
      held,
    );
    const closer = [...cars, car(5, 40 - VOICE_SWAP_MARGIN_M * 2)];
    expect(assignVoices(held, closer, listener, ENGINE_VOICES, anyCar)).toEqual(
      [1, 2, 3, 5],
    );
  });

  it("frees a voice when its car drops out of the running", () => {
    const within = (source: TrafficSource): boolean => source.x < 100;
    const before = assignVoices(
      NONE,
      [car(1, 10), car(2, 20)],
      listener,
      ENGINE_VOICES,
      within,
    );
    const after = assignVoices(
      before,
      [car(1, 10), car(2, 150)],
      listener,
      ENGINE_VOICES,
      within,
    );
    expect(after).toEqual([1, null, null, null]);
  });

  it("puts sirens only on siren cars, and engines never on parked ones", () => {
    const cars = [car(1, 10), car(2, 60, true), car(3, 90, true)];
    expect(
      assignVoices([null, null], cars, listener, 2, (source) => source.siren),
    ).toEqual([2, 3]);
    const parked = { ...car(4, 5), speedMps: 0 };
    expect(
      assignVoices(
        NONE,
        [parked, car(1, 10)],
        listener,
        ENGINE_VOICES,
        (source) => source.speedMps > 0.5,
      ),
    ).toEqual([1, null, null, null]);
  });
});
