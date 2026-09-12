/**
 * A whole match in one process: a host and N headless clients over a real transport.
 *
 * This is the harness behind Plan 3b's acceptance. The owner descoped spec §14's four-player
 * session on 2026-09-07 and chose bots instead, so what stands in its place is this — the real
 * host loop, the real client loops, the real wire format, and a transport that is an
 * implementation rather than a mock. The only thing missing against a live match is Ably itself.
 */

import { createArenaState, type ArenaWorld } from "../sim/arena";
import { createRng } from "../sim/rng";
import { createInput, type ArenaState, type WorldInput } from "../sim/types";
import type { MapZone } from "../world/mapTypes";
import type { SpawnGraph } from "../sim/spawn";
import type { MapIndex } from "../world/mapTypes";
import { createClientLoop, type ClientLoop } from "./clientLoop";
import { createHostLoop, HOST_TICK_HZ, type HostLoop } from "./hostLoop";
import { createMemoryTransport, type MemoryHub } from "./memoryTransport";

/** The room every bot match runs in. */
export const BOT_ROOM_CODE = "BOTS24";
/** One simulated frame. */
export const BOT_STEP_MS = 1000 / HOST_TICK_HZ;

/** One headless client in a bot match. */
export type BotClient = {
  clientId: string;
  playerId: number;
  loop: ClientLoop;
  /** The world this bot believes in, after its own prediction. */
  state(): ArenaState;
  /** The world this bot would draw. */
  view(): ArenaState;
};

/** A running bot match. */
export type BotMatch = {
  /** Advances host and bots by one frame and delivers everything in flight. */
  tick(): void;
  /** The host's authoritative world. */
  hostState(): ArenaState;
  bots: BotClient[];
  /** Stops the host, as though its tab had closed — used by the migration run. */
  stopHost(): void;
  host: HostLoop;
};

/** What a bot match needs to build a world. */
export type BotMatchOptions = {
  hub: MemoryHub;
  index: MapIndex;
  graph: SpawnGraph & ArenaWorld["graph"];
  world: ArenaWorld;
  zone: MapZone;
  seed: number;
  bots: number;
  /** The input a bot holds on a given tick; the default walks, turns, fires and boards. */
  script?: (tick: number, botIndex: number) => WorldInput;
};

/**
 * The default bot script: walk, turn every 60 ticks, fire every 30, press Enter every 90.
 * `botIndex` offsets the pattern so no two bots do the same thing on the same tick.
 */
export function defaultBotScript(tick: number, botIndex: number): WorldInput {
  const phase = tick + botIndex * 137;
  const angle = Math.floor(phase / 60) % 4;
  return createInput({
    move: [angle === 0 ? 1 : angle === 2 ? -1 : 0, angle === 1 ? 1 : 0],
    fire: phase % 30 === 0,
    enter: phase % 90 === 0,
    weaponNext: phase % 45 === 0,
    aim: (phase % 360) * (Math.PI / 180),
  });
}

/**
 * Starts a match with a host and `bots` headless clients.
 *
 * Every bot gets its own transport on the shared hub, is seated by the host, and runs a real
 * client loop against the player id the host gave it.
 *
 * @param options - The world, the seed and how many bots to seat.
 * @returns The match, driven one frame at a time with {@link BotMatch.tick}.
 */
export function startBotMatch(options: BotMatchOptions): BotMatch {
  const { hub, index, graph, world, zone, seed } = options;
  const script = options.script ?? defaultBotScript;
  const hostTransport = createMemoryTransport(hub, "host");
  let serverTimeMs = 0;

  const host = createHostLoop({
    transport: hostTransport,
    roomCode: BOT_ROOM_CODE,
    world,
    state: createArenaState({ index, graph, seed, zone }, createRng(seed)),
    random: createRng(seed + 1),
    serverTimeMs: () => serverTimeMs,
  });

  const bots: BotClient[] = [];
  for (let botIndex = 0; botIndex < options.bots; botIndex += 1) {
    const clientId = `bot-${botIndex}`;
    const playerId = host.addMember(clientId);
    if (playerId === null) break;
    const transport = createMemoryTransport(hub, clientId);
    const loop = createClientLoop({
      transport,
      roomCode: BOT_ROOM_CODE,
      world,
      playerId,
      // Bots start from the host's world as it stands when they are seated, which is what a real
      // late joiner gets from the next full snapshot.
      state: host.state(),
      random: createRng(seed + 100 + botIndex),
      serverTimeMs: () => serverTimeMs,
    });
    bots.push({
      clientId,
      playerId,
      loop,
      state: () => loop.state(),
      view: () => loop.view(),
    });
  }

  let tickCount = 0;
  let lastMs = 0;

  return {
    tick(): void {
      tickCount += 1;
      // Scheduled on whole milliseconds from the tick count, not by adding 1000/30 each frame:
      // summing six hundred of those lands just under 20 000 ms and the last tick never fires.
      // Integer deltas also match what a browser actually hands a frame callback.
      const nowMs = Math.round((tickCount * 1000) / HOST_TICK_HZ);
      const deltaMs = nowMs - lastMs;
      lastMs = nowMs;
      serverTimeMs = nowMs;
      // Bots move and publish first, the hub carries their inputs to the host, the host steps and
      // publishes, and the hub carries that back — the order a real frame happens in.
      for (const [botIndex, bot] of bots.entries()) {
        bot.loop.setInput(script(tickCount, botIndex));
        bot.loop.advance(deltaMs);
      }
      hub.flush();
      host.advance(deltaMs);
      hub.flush();
    },
    hostState: () => host.state(),
    bots,
    stopHost: () => host.stop(),
    host,
  };
}

/**
 * How far apart two worlds put the same player.
 *
 * @param first - One world.
 * @param second - The other.
 * @param playerId - The player to compare.
 * @returns The distance in metres, or `null` when either world has lost the player.
 */
export function playerDistance(
  first: ArenaState,
  second: ArenaState,
  playerId: number,
): number | null {
  const here = first.players.find((player) => player.id === playerId);
  const there = second.players.find((player) => player.id === playerId);
  if (!here || !there) return null;
  return Math.hypot(here.x - there.x, here.y - there.y);
}
