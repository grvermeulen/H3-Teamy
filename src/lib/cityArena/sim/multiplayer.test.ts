import { describe, expect, it } from "vitest";
import { createCollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState, stepArena, type ArenaWorld } from "./arena";
import { checkInvariants } from "./invariants";
import { localPlayer, orderedPlayers, playersOf } from "./players";
import { createRng } from "./rng";
import { createInput, type ArenaInputs, type ArenaState } from "./types";

/**
 * The acceptance test for Plan 3a. The owner descoped spec §14's four-player session on
 * 2026-09-07, so this is what stands in its place: two players, scripted for 600 ticks, with
 * the invariant checker run every tick and the whole run repeated to prove it is deterministic.
 */

const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [600, 0],
  radius: 2000,
  spawnNodes: [
    [0, 0],
    [400, 0],
    [800, 0],
    [1200, 0],
  ],
  landmarks: [],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [zone],
  landmarks: [],
};
const graph = decodeRoadGraph({
  nodes: [0, 0, 1200, 0],
  edges: [0, 1, 0, -1, 0, 1200],
  classes: ["residential"],
  names: [],
});
const world: ArenaWorld = { collision: createCollisionGrid(), index, graph };
const STEP_S = 1 / 30;
const TICKS = 600;

/** The booted state plus a second player 20 m east, sharing the first one's loadout. */
function twoPlayerState(seed: number): ArenaState {
  const state = createArenaState({ index, graph, seed, zone }, createRng(seed));
  const first = localPlayer(state);
  return {
    ...state,
    players: [first, { ...first, id: first.id + 1, x: first.x + 20 }],
  };
}

/**
 * A repeating input pattern: walk, turn every 60 ticks, fire every 30 and press Enter every 90.
 * `offset` shifts the pattern so the two players are never doing the same thing on the same tick.
 */
function scriptedInput(tick: number, offset: number) {
  const phase = tick + offset;
  const angle = Math.floor(phase / 60) % 4;
  return createInput({
    move: [angle === 0 ? 1 : angle === 2 ? -1 : 0, angle === 1 ? 1 : 0],
    fire: phase % 30 === 0,
    enter: phase % 90 === 0,
    weaponNext: phase % 45 === 0,
    aim: (phase % 360) * (Math.PI / 180),
  });
}

/** Runs the scripted match from a fresh state and returns the final state. */
function runScripted(seed: number, onTick?: (state: ArenaState) => void) {
  const random = createRng(seed + 1);
  let state = twoPlayerState(seed);
  for (let tick = 1; tick <= TICKS; tick += 1) {
    const inputs: ArenaInputs = new Map(
      orderedPlayers(state).map((player, position) => [
        player.id,
        scriptedInput(tick, position * 137),
      ]),
    );
    state = stepArena(state, inputs, STEP_S, world, random);
    onTick?.(state);
  }
  return state;
}

describe("two-player simulation", () => {
  it("runs 600 ticks of two scripted players without an invariant violation", () => {
    const violations: string[] = [];
    const final = runScripted(7, (state) => {
      violations.push(...checkInvariants(state));
    });
    expect(violations).toEqual([]);
    expect(playersOf(final)).toHaveLength(2);
    expect(final.tick).toBe(TICKS);
  });

  it("is deterministic: the same seed and inputs give the same state", () => {
    expect(runScripted(7)).toEqual(runScripted(7));
  });

  it("keeps the two players apart: they walk their own scripts", () => {
    const final = runScripted(7);
    const [first, second] = orderedPlayers(final);
    expect(first.x).not.toBe(second.x);
  });
});
