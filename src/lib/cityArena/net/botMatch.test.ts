import { describe, expect, it } from "vitest";
import { boundsOf } from "../mapBuild/geometry";
import { createCollisionGrid } from "../world/collisionGrid";
import { structureIdOf } from "../world/structureId";
import type { MapIndex, MapZone } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { decodeRoadGraph } from "../world/roadGraph";
import { stepArena, type ArenaWorld } from "../sim/arena";
import { checkInvariants } from "../sim/invariants";
import { playersOf } from "../sim/players";
import { createRng } from "../sim/rng";
import { destroyedStructureIds, damageStructure } from "../sim/structures";
import { createInput } from "../sim/types";
import { createMemoryHub } from "./memoryTransport";
import { HOST_TICK_HZ, SNAPSHOT_HZ } from "./hostLoop";
import { PLAYER_MAX_HEALTH } from "../sim/damage";
import { playerDistance, startBotMatch } from "./botMatch";

/**
 * Plan 3b's acceptance, replacing the four-player session the owner descoped on 2026-09-07: a
 * host and three headless bots over the real transport, asserted to converge on the host's world.
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

const TICKS = 600;
const BOTS = 3;
/**
 * How far a bot's own player may sit from the host's version of it.
 *
 * A bot predicts ahead of the last snapshot it received — a snapshot interval of walking is about
 * 0.4 m — so some gap is correct behaviour, not drift. Observed on a clean line is 2-5 cm; half a
 * metre leaves room for that prediction lead without being loose enough to hide a real divergence.
 */
const CONVERGENCE_M = 0.5;

/** Runs a bot match for `ticks`, collecting the host's invariant violations every tick. */
function runMatch(
  seed: number,
  ticks = TICKS,
  hub = createMemoryHub(),
  onTick?: (tick: number, match: ReturnType<typeof startBotMatch>) => void,
) {
  const match = startBotMatch({
    hub,
    index,
    graph,
    world,
    zone,
    seed,
    bots: BOTS,
  });
  const violations: string[] = [];
  for (let tick = 1; tick <= ticks; tick += 1) {
    match.tick();
    violations.push(...checkInvariants(match.hostState()));
    onTick?.(tick, match);
  }
  return { match, violations };
}

describe("bot match acceptance", () => {
  it("seats every bot as its own player", () => {
    const { match } = runMatch(7, 1);
    expect(match.bots).toHaveLength(BOTS);
    expect(playersOf(match.hostState())).toHaveLength(BOTS + 1);
    expect(new Set(match.bots.map((bot) => bot.playerId)).size).toBe(BOTS);
  });

  it("runs 600 ticks of three bots without an invariant violation", () => {
    const { match, violations } = runMatch(7);
    expect(violations).toEqual([]);
    expect(match.hostState().tick).toBe(TICKS);
    expect(playersOf(match.hostState())).toHaveLength(BOTS + 1);
  });

  it("actually plays a match, so convergence is not trivially true", () => {
    // A convergence test passes for free if nobody moved and nobody shot. These are the guards
    // that keep the acceptance meaningful if the bot script or the sim ever quietly changes.
    const hub = createMemoryHub();
    const match = startBotMatch({
      hub,
      index,
      graph,
      world,
      zone,
      seed: 7,
      bots: BOTS,
    });
    const start = new Map(
      match
        .hostState()
        .players.map((player) => [player.id, { x: player.x, y: player.y }]),
    );
    for (let tick = 1; tick <= TICKS; tick += 1) match.tick();
    for (const bot of match.bots) {
      const from = start.get(bot.playerId)!;
      const player = match
        .hostState()
        .players.find((candidate) => candidate.id === bot.playerId)!;
      const travelled = Math.hypot(player.x - from.x, player.y - from.y);
      expect({ bot: bot.clientId, moved: travelled > 10 }).toEqual({
        bot: bot.clientId,
        moved: true,
      });
    }
    // Bots shoot each other, which is the multiplayer combat path end to end.
    const hurt = match.bots.filter((bot) => {
      const player = match
        .hostState()
        .players.find((candidate) => candidate.id === bot.playerId);
      return player !== undefined && player.health < PLAYER_MAX_HEALTH;
    });
    expect(hurt.length).toBeGreaterThan(0);
  });

  it("converges every bot on the host's world", () => {
    const { match } = runMatch(7);
    for (const bot of match.bots) {
      const gap = playerDistance(bot.state(), match.hostState(), bot.playerId);
      expect({ bot: bot.clientId, converged: gap !== null }).toEqual({
        bot: bot.clientId,
        converged: true,
      });
      expect({
        bot: bot.clientId,
        within: (gap ?? Infinity) < CONVERGENCE_M,
      }).toEqual({ bot: bot.clientId, within: true });
    }
  });

  it("gives every bot the whole roster, not just itself", () => {
    const { match } = runMatch(7);
    for (const bot of match.bots)
      expect({
        bot: bot.clientId,
        players: playersOf(bot.state()).length,
      }).toEqual({ bot: bot.clientId, players: BOTS + 1 });
  });

  it("is deterministic: the same seed gives the same match", () => {
    const first = runMatch(11, 120);
    const second = runMatch(11, 120);
    expect(first.match.hostState()).toEqual(second.match.hostState());
  });
});

describe("bot match under packet loss", () => {
  it("keeps the host advancing and the bots converged with a tenth of inputs dropped", () => {
    const lossy = createMemoryHub({ dropRate: 0.1, random: createRng(3) });
    const { match, violations } = runMatch(13, TICKS, lossy);
    expect(violations).toEqual([]);
    expect(match.hostState().tick).toBe(TICKS);
    for (const bot of match.bots) {
      const gap = playerDistance(bot.state(), match.hostState(), bot.playerId);
      // Dropped inputs cost responsiveness, never consistency: a bot may be further from the
      // host than on a clean line, but it must not have drifted off into its own world.
      expect({
        bot: bot.clientId,
        within: (gap ?? Infinity) < CONVERGENCE_M * 5,
      }).toEqual({ bot: bot.clientId, within: true });
    }
  });
});

/**
 * What happens when the host stops. This does *not* exercise election among the bots — a bot
 * does not yet promote itself to host — so it proves the roster and the bots' own prediction
 * survive the loss, not that the match resumes. Migration at match scale is asserted once the
 * real client runs the election, which is where a new host actually comes from.
 */
describe("bot match when the host stops", () => {
  it("keeps every player when the host stops mid-match", () => {
    const hub = createMemoryHub();
    const { match, violations } = runMatch(17, TICKS, hub, (tick, running) => {
      if (tick === 300) running.stopHost();
    });
    expect(violations).toEqual([]);
    // The host froze at 300; its roster must survive rather than collapse.
    expect(playersOf(match.hostState())).toHaveLength(BOTS + 1);
    expect(match.hostState().tick).toBe(300);
  });

  it("lets the bots carry on predicting after the host goes quiet", () => {
    const hub = createMemoryHub();
    const { match } = runMatch(19, TICKS, hub, (tick, running) => {
      if (tick === 300) running.stopHost();
    });
    for (const bot of match.bots)
      expect({
        bot: bot.clientId,
        ahead: bot.state().tick > 300,
      }).toEqual({ bot: bot.clientId, ahead: true });
  });
});

/**
 * Task 5's acceptance beyond movement and combat convergence: a live structure collapse must
 * reach every bot over the wire, through the real `applySnapshot` path, within the budget spec
 * §3.6 implies — and the client's own predicted movement, the actual path a networked player
 * takes (`predictLocal`, via the real client loop), must be able to walk through the footprint
 * once the wire says the building is gone. Controller Ruling 29: an earlier version of this test
 * only checked a `withoutStructures` view built for the assertion itself, which the client never
 * actually uses — it passed even while `predictLocal` still collided with the rubble, rubber-
 * banding every non-host player at every ruin. The second test below drives the bot's own client
 * loop directly instead.
 */
describe("bot match structure collapse", () => {
  /** The footprint's near and far edge, metres north of the origin. */
  const BUILDING_NEAR_EDGE_M = 10;
  const BUILDING_FAR_EDGE_M = 30;
  /** How wide the footprint is, either side of the origin's x. */
  const BUILDING_HALF_WIDTH_M = 10;
  /**
   * A footprint just north of the fixture's shared spawn point — every player in this zone/graph
   * fixture spawns at the origin (`spawnPointIn` clusters new players on the first one) — clear of
   * the parked cars `createArenaState` lines up along the road at y ≈ -3.3 east of the origin, so a
   * bot walking straight into it hits nothing but the building.
   */
  const buildingRing: Point[] = [
    [-BUILDING_HALF_WIDTH_M, BUILDING_NEAR_EDGE_M],
    [BUILDING_HALF_WIDTH_M, BUILDING_NEAR_EDGE_M],
    [BUILDING_HALF_WIDTH_M, BUILDING_FAR_EDGE_M],
    [-BUILDING_HALF_WIDTH_M, BUILDING_FAR_EDGE_M],
  ];
  const buildingId = structureIdOf(0, 0, 0);
  /** The host tick the building is fully damaged on. */
  const COLLAPSE_TICK = 5;
  const TICKS_PER_SNAPSHOT = HOST_TICK_HZ / SNAPSHOT_HZ;

  /** A world like the shared fixture, plus one destructible building. */
  function worldWithBuilding(): ArenaWorld {
    const collision = createCollisionGrid();
    collision.insertTile({
      x: 0,
      y: 0,
      rect: { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 },
      trees: [],
      furniture: [],
      roads: [],
      ground: [],
      water: [],
      buildings: [
        {
          structureId: buildingId,
          ring: buildingRing,
          bounds: boundsOf(buildingRing),
          levels: 1,
        },
      ],
    });
    return { collision, index, graph };
  }

  /**
   * Runs the real step every tick, then — once, at {@link COLLAPSE_TICK} — fully damages the
   * building in one hit. Standing in for "someone blew it up": this acceptance is about the wire
   * and the client's reaction, not about aiming a rocket through the whole combat pipeline.
   */
  function collapseAt(world: ArenaWorld): typeof stepArena {
    return (state, inputs, dt, stepWorld, random) => {
      const stepped = stepArena(state, inputs, dt, stepWorld, random);
      if (stepped.tick !== COLLAPSE_TICK) return stepped;
      const obstacle = world.collision
        .query(boundsOf(buildingRing))
        .find((candidate) => candidate.structure?.id === buildingId);
      if (!obstacle?.structure)
        throw new Error("test building obstacle missing from the grid");
      return damageStructure(
        stepped,
        { obstacle, amount: obstacle.structure.maxHealth, killerId: null },
        stepped.tick,
      );
    };
  }

  /** True once every bot's own state lists {@link buildingId} as destroyed. */
  function allBotsSeeItDestroyed(
    match: ReturnType<typeof startBotMatch>,
  ): boolean {
    return match.bots.every((bot) =>
      (bot.state().structures ?? []).some(
        (entry) => entry.id === buildingId && entry.destroyedAtTick !== null,
      ),
    );
  }

  /** Ticks `match` until every bot has adopted the collapse, or `deadline` runs out. */
  function tickUntilConverged(
    match: ReturnType<typeof startBotMatch>,
    deadline: number,
  ): number | null {
    for (let tick = 1; tick <= deadline; tick += 1) {
      match.tick();
      if (allBotsSeeItDestroyed(match)) return tick;
    }
    return null;
  }

  /** A fresh match with the collapse scripted at {@link COLLAPSE_TICK}. */
  function startCollapseMatch(
    world: ArenaWorld,
  ): ReturnType<typeof startBotMatch> {
    return startBotMatch({
      hub: createMemoryHub(),
      index,
      graph,
      world,
      zone,
      seed: 23,
      bots: BOTS,
      step: collapseAt(world),
    });
  }

  it("propagates a live collapse to every bot within 10 snapshots", () => {
    const match = startCollapseMatch(worldWithBuilding());
    const seenAtTick = tickUntilConverged(
      match,
      COLLAPSE_TICK + TICKS_PER_SNAPSHOT * 10,
    );

    expect(seenAtTick).not.toBeNull();
    expect(seenAtTick! - COLLAPSE_TICK).toBeLessThanOrEqual(
      TICKS_PER_SNAPSHOT * 10,
    );
    for (const bot of match.bots)
      expect({
        bot: bot.clientId,
        destroyed: destroyedStructureIds(bot.state()).has(buildingId),
      }).toEqual({ bot: bot.clientId, destroyed: true });
  });

  /**
   * The regression this task exists to close: a networked client that only *learns* a building is
   * gone (the test above) but still bounces off its own predicted copy of the rubble would
   * rubber-band at every ruin. Driving the bot's own client loop directly — bypassing
   * `match.tick()`, so no further host snapshot can paper over the bug by re-adopting the host's
   * unaffected position — isolates exactly the collision path `predictLocal` takes.
   */
  it("lets a bot's own predicted movement walk through a collapsed building's footprint", () => {
    const match = startCollapseMatch(worldWithBuilding());
    const seenAtTick = tickUntilConverged(
      match,
      COLLAPSE_TICK + TICKS_PER_SNAPSHOT * 10,
    );
    expect(seenAtTick).not.toBeNull();

    const bot = match.bots[0]!;
    bot.loop.setInput(createInput({ move: [0, 1] }));
    for (let second = 0; second < 10; second += 1) bot.loop.advance(1000);
    const finalY = bot.state().players.find((p) => p.id === bot.playerId)!.y;

    // Clearing the far edge, not merely reaching the near one, proves the client predicted its
    // way all the way through the rubble rather than stopping at what used to be the wall.
    expect(finalY).toBeGreaterThan(BUILDING_FAR_EDGE_M);
  });
});
