import { beforeEach, describe, expect, it, vi } from "vitest";
import { boundsOf } from "../mapBuild/geometry";
import type { DecodedTile } from "../world/decode";
import type { Point } from "../world/projection";
import {
  AMBIENCE_IDLE_STOP_S,
  SURROUNDINGS_READ_S,
  createAmbienceBed,
  type BedWorld,
} from "./ambienceBed";
import type { ClipName } from "./clips";
import type { LoopHandle, SamplePlayer } from "./samples";
import type { Listener } from "./spatial";

const here: Listener = { x: 0, y: 0, facing: 0 };
const FRAME_S = 0.1;

/** A player holding `clips`, whose loops are spies, one per start. */
function looping(clips: ClipName[]): {
  player: SamplePlayer;
  loops: Map<ClipName, LoopHandle>;
} {
  const loops = new Map<ClipName, LoopHandle>();
  const player: SamplePlayer = {
    preload: vi.fn(async () => undefined),
    play: vi.fn(() => true),
    has: (clip) => clips.includes(clip),
    liveVoices: () => 0,
    startLoop: vi.fn((clip: ClipName) => {
      const loop = { setRate: vi.fn(), setPlacement: vi.fn(), stop: vi.fn() };
      loops.set(clip, loop);
      return loop;
    }),
  };
  return { player, loops };
}

/** A frame in a park: grass all around. */
function park(dt = FRAME_S): BedWorld {
  const ring: Point[] = [
    [-300, -300],
    [300, -300],
    [300, 300],
    [-300, 300],
  ];
  const tile: DecodedTile = {
    x: 0,
    y: 0,
    rect: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
    roads: [],
    buildings: [],
    ground: [{ ring, bounds: boundsOf(ring), kind: "grass" }],
    water: [],
    trees: [],
    furniture: [],
  };
  return { dt, tiles: [tile], peds: [], traffic: [] };
}

/** A frame with nothing around at all. */
function nowhere(dt = FRAME_S): BedWorld {
  return { dt, tiles: [], peds: [], traffic: [] };
}

describe("createAmbienceBed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("brings the birds in over a second and a half in a park, never at once", () => {
    const { player, loops } = looping(["amb-birds"]);
    const bed = createAmbienceBed(() => player);
    bed.update(park(), here, true);
    expect(bed.levels()["amb-birds"]).toBeCloseTo(FRAME_S / 1.5);
    for (let frame = 0; frame < 20; frame++) bed.update(park(), here, true);
    expect(bed.levels()["amb-birds"]).toBeCloseTo(0.8);
    const placement = vi.mocked(loops.get("amb-birds")!.setPlacement).mock
      .lastCall![0];
    expect(placement.gain).toBeCloseTo(0.8);
    expect(placement.pan).toBe(0);
  });

  it("reads the surroundings at most every half second", () => {
    const { player } = looping([]);
    const bed = createAmbienceBed(() => player);
    bed.update(park(), here, true);
    const quick = SURROUNDINGS_READ_S / 5;
    bed.update(nowhere(quick), here, true);
    expect(bed.surroundings().greenShare).toBe(1);
    bed.update(nowhere(SURROUNDINGS_READ_S), here, true);
    expect(bed.surroundings().greenShare).toBe(0);
  });

  it("fades out and then stops every loop once Omgevingsgeluid is off", () => {
    const { player, loops } = looping(["amb-birds"]);
    const bed = createAmbienceBed(() => player);
    for (let frame = 0; frame < 20; frame++) bed.update(park(), here, true);
    for (let frame = 0; frame < 20; frame++) bed.update(park(), here, false);
    expect(bed.levels()["amb-birds"]).toBe(0);
    const stops = Math.ceil(AMBIENCE_IDLE_STOP_S / FRAME_S);
    for (let frame = 0; frame < stops; frame++) bed.update(park(), here, false);
    expect(loops.get("amb-birds")!.stop).toHaveBeenCalledTimes(1);
  });

  it("stays silent without its clips: there is no synthesised ambience", () => {
    const { player } = looping([]);
    const bed = createAmbienceBed(() => player);
    for (let frame = 0; frame < 20; frame++) bed.update(park(), here, true);
    expect(player.startLoop).not.toHaveBeenCalled();
    expect(bed.levels()["amb-birds"]).toBeGreaterThan(0);
  });
});
