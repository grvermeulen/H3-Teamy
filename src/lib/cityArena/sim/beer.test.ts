import { describe, expect, it } from "vitest";
import type { MapIndex, MapLandmark } from "../world/mapTypes";
import { createArenaState, stepArena } from "./arena";
import {
  BEER_ORDER_RANGE_M,
  DRUNK_DAMAGE_REDUCTION,
  DRUNK_DECAY_PER_TICK,
  DRUNK_PER_BEER,
  breweryAt,
  canOrderBeer,
  drunkDamageFactor,
  orderBeer,
  soberUp,
} from "./beer";
import { WEAPONS } from "./weapons";
import { localPlayer } from "./players";
import { createRng } from "./rng";
import { createInput, type ArenaState } from "./types";
import { createVehicle } from "./vehicle";

const brewery: MapLandmark = {
  key: "klein-zwitserland",
  name: "Brouwerij Klein Zwitserland",
  style: "brewery",
  center: [400, 0],
  tile: { x: 0, y: 0 },
};
const church: MapLandmark = {
  key: "cunerakerk",
  name: "Cunerakerk",
  style: "church",
  center: [-400, 0],
  tile: { x: 0, y: 0 },
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-12",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -8000, minY: -8000, maxX: 8000, maxY: 8000 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [church, brewery],
};
const graph = {
  nodes: [],
  edges: [],
  adjacency: [],
  nearestNode: () => null,
};
const world = {
  collision: {
    resolveCircle: (point: [number, number]) => point,
    query: () => [],
  },
  index,
  graph,
};

/** A fresh world with the player standing `metresFromTap` east of the brewery's centre. */
function atTap(metresFromTap = 2): ArenaState {
  const base = createArenaState(
    { index, graph, seed: 1, zone: null },
    createRng(1),
  );
  const player = { ...localPlayer(base), x: 100 + metresFromTap, y: 0 };
  return { ...base, players: [player] };
}

const press = createInput({ enter: true });
const release = createInput({});

function run(state: ArenaState, input = release, ticks = 1): ArenaState {
  let next = state;
  for (let index = 0; index < ticks; index += 1)
    next = stepArena(next, new Map([[0, input]]), 1 / 30, world, createRng(2));
  return next;
}

describe("the brewery", () => {
  it("serves within reach of a brewery landmark, and nowhere else", () => {
    expect(breweryAt(index, { x: 100 + BEER_ORDER_RANGE_M, y: 0 })?.key).toBe(
      "klein-zwitserland",
    );
    expect(
      breweryAt(index, { x: 100 + BEER_ORDER_RANGE_M + 0.1, y: 0 }),
    ).toBeNull();
    expect(breweryAt(index, { x: -100, y: 0 })).toBeNull();
  });

  it("refuses the dead and the seated", () => {
    const player = localPlayer(atTap());
    expect(canOrderBeer(index, player)).toBe(true);
    expect(canOrderBeer(index, { ...player, diedAtTick: 3, health: 0 })).toBe(
      false,
    );
    expect(canOrderBeer(index, { ...player, vehicleId: 7 })).toBe(false);
  });

  it("pours one beer per press of Instappen, records the event and caps at fully drunk", () => {
    const first = run(atTap(), press);
    // Poured this tick, and already worn off by one tick's worth.
    expect(localPlayer(first).drunk).toBeCloseTo(
      DRUNK_PER_BEER - DRUNK_DECAY_PER_TICK,
      9,
    );
    expect(first.events).toContainEqual({
      kind: "beer",
      playerId: 0,
      x: localPlayer(first).x,
      y: localPlayer(first).y,
    });
    // Holding the button is one press: nothing more is poured.
    expect(localPlayer(run(first, press)).drunk).toBeLessThanOrEqual(
      DRUNK_PER_BEER,
    );
    let state = first;
    for (let round = 0; round < 4; round += 1)
      state = run(run(state, release), press);
    expect(localPlayer(state).drunk).toBeLessThanOrEqual(1);
    expect(localPlayer(state).drunk).toBeGreaterThan(0.95);
  });

  it("boards a car in reach instead of ordering", () => {
    const base = atTap();
    const car = createVehicle(50, "sedan", [localPlayer(base).x + 1, 0], 0, 0);
    const state = { ...base, vehicles: [car] };
    const next = run(state, press);
    expect(localPlayer(next).vehicleId).toBe(car.id);
    expect(localPlayer(next).drunk).toBe(0);
  });

  it("does nothing away from the tap", () => {
    const next = run(atTap(BEER_ORDER_RANGE_M + 5), press);
    expect(localPlayer(next).drunk).toBe(0);
    expect(next.events.some((event) => event.kind === "beer")).toBe(false);
  });

  it("wears off a little every tick and never below sober", () => {
    const drunk = orderBeer(atTap(), localPlayer(atTap()), index);
    const sobered = soberUp(drunk);
    expect(localPlayer(sobered).drunk).toBeCloseTo(
      DRUNK_PER_BEER - DRUNK_DECAY_PER_TICK,
      9,
    );
    const later = run(drunk, release, 30 * 60);
    expect(localPlayer(later).drunk).toBe(0);
    expect(soberUp(later)).toBe(later);
  });

  it("scales the damage factor down with drunkenness, halving it when fully drunk", () => {
    expect(drunkDamageFactor(0)).toBe(1);
    expect(drunkDamageFactor(0.5)).toBeCloseTo(
      1 - DRUNK_DAMAGE_REDUCTION / 2,
      9,
    );
    expect(drunkDamageFactor(1)).toBe(1 - DRUNK_DAMAGE_REDUCTION);
    // Clamped, so a state that somehow left the invariant cannot heal a target.
    expect(drunkDamageFactor(7)).toBe(1 - DRUNK_DAMAGE_REDUCTION);
    expect(drunkDamageFactor(-1)).toBe(1);
  });

  it("weakens the shots a drunk player fires, and leaves a sober one's alone", () => {
    const aim = createInput({ fire: true, aim: 0 });
    const base = atTap();
    const sober = run(base, aim);
    expect(sober.bullets[0]?.damage).toBe(WEAPONS.pistol.damage);
    const drunk = run(
      { ...base, players: [{ ...localPlayer(base), drunk: 1 }] },
      aim,
    );
    expect(drunk.bullets[0]?.damage).toBeCloseTo(
      WEAPONS.pistol.damage * (1 - DRUNK_DAMAGE_REDUCTION),
      9,
    );
  });
});
