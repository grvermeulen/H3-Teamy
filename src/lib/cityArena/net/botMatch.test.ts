import { describe, expect, it } from "vitest";
import { createCollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import type { ArenaWorld } from "../sim/arena";
import { checkInvariants } from "../sim/invariants";
import { playersOf } from "../sim/players";
import { createRng } from "../sim/rng";
import { createMemoryHub } from "./memoryTransport";
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

describe("bot match host migration", () => {
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
