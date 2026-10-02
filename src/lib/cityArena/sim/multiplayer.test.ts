import { describe, expect, it } from "vitest";
import { createCollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import {
  createArenaState,
  removeArenaPlayer,
  stepArena,
  teleportArenaPlayer,
  type ArenaWorld,
} from "./arena";
import { PLAYER_MAX_HEALTH } from "./damage";
import { checkInvariants } from "./invariants";
import { localPlayer, orderedPlayers, playerById, playersOf } from "./players";
import { createRng } from "./rng";
import { createInput, type ArenaInputs, type ArenaState } from "./types";
import { createVehicle } from "./vehicle";

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

/**
 * An empty world holding two players on foot along y = 0, `gapM` apart. Nothing else populates
 * it, so a bullet fired east from the first can only meet the second.
 */
function facingPair(seed: number, gapM: number): ArenaState {
  const state = createArenaState({ index, graph, seed, zone }, createRng(seed));
  const first = { ...localPlayer(state), x: 0, y: 0, facing: 0 };
  return {
    ...state,
    players: [first, { ...first, id: first.id + 1, x: gapM }],
    peds: [],
    cops: [],
    traffic: [],
    vehicles: [],
    pickups: [],
  };
}

/**
 * The paths that read a single player out of shared state. Each of these silently dropped or
 * ignored every player but the local one until CodeRabbit caught them on PR #658; the
 * 600-tick script above never blew up a car, never crossed two players' fire and never
 * teleports, so it could not have found them.
 */
describe("state shared by several players", () => {
  it("lets a bullet hit a remote player, not only the local one", () => {
    let state = facingPair(11, 8);
    const random = createRng(5);
    const inputs: ArenaInputs = new Map([
      [0, createInput({ fire: true, aim: 0 })],
    ]);
    for (let tick = 1; tick <= 10; tick += 1)
      state = stepArena(state, inputs, STEP_S, world, random);
    expect(playerById(state, 1)?.health).toBeLessThan(PLAYER_MAX_HEALTH);
  });

  it("blasts every player in range when a car explodes and keeps them all", () => {
    const paired = facingPair(12, 4);
    const state: ArenaState = {
      ...paired,
      vehicles: [{ ...createVehicle(90, "sedan", [2, 0], 0, 0), health: 0 }],
    };
    const next = stepArena(state, new Map(), STEP_S, world, createRng(6));
    expect(playersOf(next)).toHaveLength(2);
    for (const player of orderedPlayers(next))
      expect(player.health).toBeLessThan(PLAYER_MAX_HEALTH);
  });

  it("keeps the other players where they stand when one teleports", () => {
    const moved = teleportArenaPlayer(facingPair(13, 6), [150, 0], index);
    expect(orderedPlayers(moved).map((player) => player.id)).toEqual([0, 1]);
    expect(playerById(moved, 0)?.x).toBe(150);
    expect(playerById(moved, 1)?.x).toBe(6);
  });

  it("records a kill naming the shooter when a bullet finishes a player", () => {
    let state = facingPair(21, 6);
    // Wound the target to one hit from death, so a single burst finishes them.
    state = {
      ...state,
      players: state.players.map((player) =>
        player.id === 1 ? { ...player, health: 1 } : player,
      ),
    };
    const random = createRng(5);
    const inputs: ArenaInputs = new Map([
      [0, createInput({ fire: true, aim: 0 })],
    ]);
    const kills: { victimId: number | null; killerId: number | null }[] = [];
    for (let tick = 1; tick <= 20; tick += 1) {
      state = stepArena(state, inputs, STEP_S, world, random);
      for (const event of state.events)
        if (event.kind === "kill" && event.victim === "player")
          kills.push({ victimId: event.victimId, killerId: event.killerId });
    }
    expect(kills).toContainEqual({ victimId: 1, killerId: 0 });
  });

  it("gives no heat for killing another player, which is the point of the potje", () => {
    // Without the explicit skip in heatFromEvents a "player" victim falls through to the
    // pedestrian branch and every duel quietly raises the police on the winner.
    let state = facingPair(22, 6);
    state = {
      ...state,
      players: state.players.map((player) =>
        player.id === 1 ? { ...player, health: 1 } : player,
      ),
    };
    const random = createRng(5);
    const inputs: ArenaInputs = new Map([
      [0, createInput({ fire: true, aim: 0 })],
    ]);
    for (let tick = 1; tick <= 20; tick += 1)
      state = stepArena(state, inputs, STEP_S, world, random);
    expect(playerById(state, 0)?.heat).toBe(0);
  });

  it("steps a state whose last player has left instead of throwing", () => {
    const paired = facingPair(14, 6);
    const empty = removeArenaPlayer(removeArenaPlayer(paired, 0), 1);
    expect(playersOf(empty)).toHaveLength(0);
    const next = stepArena(empty, new Map(), STEP_S, world, createRng(7));
    expect(checkInvariants(next)).toEqual([]);
  });
});
