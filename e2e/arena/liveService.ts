import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MAP_BASE_PATH } from "../../src/lib/cityArena/constants";
import { createAblyTransport } from "../../src/lib/cityArena/net/ablyTransport";
import {
  arenaChannels,
  type ArenaRoomTicket,
} from "../../src/lib/cityArena/net/roomProtocol";
import {
  createClientLoop,
  type ClientLoop,
} from "../../src/lib/cityArena/net/clientLoop";
import {
  createHostLoop,
  type HostLoop,
} from "../../src/lib/cityArena/net/hostLoop";
import { decodeSnapshot } from "../../src/lib/cityArena/net/snapshotWire";
import { isSnapshot } from "../../src/lib/cityArena/net/wireValidation";
import { createArenaState } from "../../src/lib/cityArena/sim/arena";
import { createRng } from "../../src/lib/cityArena/sim/rng";
import { EMPTY_INPUT } from "../../src/lib/cityArena/sim/types";
import { decodeRoadGraph } from "../../src/lib/cityArena/world/roadGraph";
import { decodeTile } from "../../src/lib/cityArena/world/decode";
import { createCollisionGrid } from "../../src/lib/cityArena/world/collisionGrid";
import { createRoadCorridors } from "../../src/lib/cityArena/world/roadCorridor";
import { rankScoreboard } from "../../src/lib/cityArena/net/scoreboard";
import type {
  MapIndex,
  MapRoads,
  MapTile,
} from "../../src/lib/cityArena/world/mapTypes";

const base = "http://localhost:3100";
const roomCode = process.argv[2];
if (!roomCode)
  throw new Error("Provide the code of the disposable local browser room");
const originalFetch = globalThis.fetch;
const cookies = new Map<string, string>();
async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await originalFetch(url, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers)),
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    },
  });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0]!;
    const split = pair.indexOf("=");
    cookies.set(pair.slice(0, split), pair.slice(split + 1));
  }
  return response;
}
globalThis.fetch = ((url, init) =>
  String(url).startsWith(base + "/api/arena/")
    ? request(String(url), init)
    : originalFetch(url, init)) as typeof fetch;
async function command(body: object): Promise<ArenaRoomTicket> {
  const response = await request(base + "/api/arena/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: base },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      `Room command failed: ${response.status} ${await response.text()}`,
    );
  return (await response.json()).ticket;
}

async function main() {
  const csrf = await (await request(base + "/api/auth/csrf")).json();
  const login = await request(base + "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email: "peer@arena.example.test",
      password: "arena-local-test-2026",
      json: "true",
      callbackUrl: base,
    }),
  });
  assert.equal(login.status, 200);
  const session = await (await request(base + "/api/auth/session")).json();
  assert.equal(session.user?.id, "arena-e2e-peer");
  let ticket = await command({
    action: "join",
    roomCode,
    joinNonce: randomUUID(),
  });
  const transport = createAblyTransport({
    authUrl: base + "/api/arena/realtime-token?memberId=" + ticket.memberId,
  });
  const identity = await transport.connect();
  assert.equal(identity.clientId, ticket.memberId);
  const crossMember = ticket.members.find(
    (member) => member.clientId !== ticket.memberId,
  )!.clientId;
  const denied = await request(
    base + "/api/arena/realtime-token?memberId=" + crossMember,
  );
  assert.equal(denied.status, 403);
  let statePublishDenied = false;
  try {
    await transport
      .channel(arenaChannels(ticket.roomId, ticket.epoch).state)
      .publish("state", { invalid: true });
  } catch {
    statePublishDenied = true;
  }
  assert.equal(statePublishDenied, true);
  const mapDir = `public${MAP_BASE_PATH}`;
  const read = <T>(file: string): T =>
    JSON.parse(fs.readFileSync(path.join(mapDir, file), "utf8"));
  const index = read<MapIndex>("index.json");
  const graph = decodeRoadGraph(read<MapRoads>("roads.json"));
  const collision = createCollisionGrid();
  collision.setRoadCorridors(createRoadCorridors(graph));
  for (const file of fs
    .readdirSync(mapDir)
    .filter((file) => file.startsWith("tile_")))
    collision.insertTile(decodeTile(read<MapTile>(file), index));
  const world = { index, graph, collision };
  const random = createRng(871);
  let state = createArenaState(
    {
      index,
      graph,
      seed: 871,
      zone: index.zones.find((zone) => zone.key === ticket.zone) ?? null,
    },
    random,
  );
  let client: ClientLoop | null = null;
  let host: HostLoop | null = null;
  const stopLoops = () => {
    client?.stop();
    host?.stop();
  };
  let unsubscribe = () => {};
  let playerId = 0;
  let snapshots = 0;
  let bytes = 0;
  let invalidSent = false;
  let completed: string | null = null;
  let heartbeatBusy = false;
  let finishBusy = false;
  const changes: object[] = [];
  const errors: string[] = [];
  const started = Date.now();
  const install = async () => {
    const seats = client?.seats() ?? host?.seats() ?? new Map();
    const accounts = client?.accounts() ?? host?.accounts() ?? new Map();
    const tally = client?.tally() ?? host?.tally();
    if (client) state = client.state();
    if (host) state = host.state();
    stopLoops();
    unsubscribe();
    client = null;
    host = null;
    const channels = arenaChannels(ticket.roomId, ticket.epoch);
    changes.push({
      elapsedMs: Date.now() - started,
      epoch: ticket.epoch,
      role: ticket.hostClientId === ticket.memberId ? "host" : "client",
    });
    if (ticket.hostClientId === ticket.memberId) {
      host = createHostLoop({
        transport,
        roomCode,
        stateChannel: channels.state,
        inputChannel: channels.inputs,
        state,
        world,
        random,
        serverTimeMs: () => Date.now() + identity.serverTimeOffsetMs,
        accounts,
        tally,
      });
      for (const [id, seat] of seats) host.claim(id, seat);
      host.claim(ticket.memberId, playerId);
    } else {
      unsubscribe = transport
        .channel(channels.state)
        .subscribe("state", (message) => {
          if (
            message.clientId !== ticket.hostClientId ||
            !isSnapshot(message.data)
          )
            return;
          snapshots++;
          bytes += Buffer.byteLength(JSON.stringify(message.data));
          if (!client && message.data.r === undefined) {
            const seat = decodeSnapshot(message.data).seats.get(
              ticket.memberId,
            );
            if (seat === undefined) return;
            playerId = seat;
            client = createClientLoop({
              transport,
              roomCode,
              stateChannel: channels.state,
              inputChannel: channels.inputs,
              playerId,
              state,
              world,
              random,
              serverTimeMs: () => Date.now() + identity.serverTimeOffsetMs,
              hostClientId: ticket.hostClientId ?? undefined,
            });
            client.onSnapshot(message.data);
          }
        });
    }
  };
  await install();
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    void command({
      action: "heartbeat",
      memberId: ticket.memberId,
      visible: true,
    })
      .then(async (next) => {
        const changed = next.epoch !== ticket.epoch;
        ticket = next;
        if (changed) {
          ticket = (await transport.refreshAuth!()) ?? ticket;
          await install();
        }
      })
      .catch((error) => errors.push(String(error)))
      .finally(() => {
        heartbeatBusy = false;
      });
  }, 3000);
  let last = performance.now();
  const frame = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(100, now - last);
    last = now;
    if (client) {
      client.setInput(EMPTY_INPUT);
      client.advance(dt);
      if (!invalidSent) {
        invalidSent = true;
        void transport
          .channel(arenaChannels(ticket.roomId, ticket.epoch).inputs)
          .publish("input", { 0: "hostile-container" });
      }
    }
    if (host) {
      const active = new Set(ticket.members.map((member) => member.clientId));
      for (const id of host.seats().keys())
        if (!active.has(id)) host.removeMember(id);
      for (const id of active) if (!host.seats().has(id)) host.addMember(id);
      const round = ticket.round;
      const clock = Date.now() + identity.serverTimeOffsetMs;
      if (round)
        host.setMatch({
          phase:
            clock < round.startedAt
              ? "countdown"
              : clock < round.finishesAt
                ? "playing"
                : "scoreboard",
          since: host.state().tick,
        });
      host.advance(dt);
      if (
        round &&
        clock > round.finishesAt + 1000 &&
        !round.completedAt &&
        completed !== round.id &&
        !finishBusy
      ) {
        finishBusy = true;
        const accountByPlayer = new Map(
          [...host.accounts()].map(([id, seat]) => [seat, id]),
        );
        const results = rankScoreboard(
          host.tally(),
          host.state().players,
          playerId,
        ).map((line) => ({
          memberId: accountByPlayer.get(line.playerId),
          kills: line.kills,
          deaths: line.deaths,
          won: line.isWinner,
        }));
        void request(base + "/api/arena/matches", {
          method: "POST",
          headers: { "Content-Type": "application/json", origin: base },
          body: JSON.stringify({
            memberId: ticket.memberId,
            epoch: ticket.epoch,
            roundId: round.id,
            results,
          }),
        })
          .then(async (response) => {
            if (!response.ok)
              throw new Error(
                `Completion ${response.status}: ${await response.text()}`,
              );
            completed = round.id;
          })
          .catch((error) => errors.push(String(error)))
          .finally(() => {
            finishBusy = false;
          });
      }
    }
  }, 1000 / 30);
  console.log(
    "Live peer connected; state publish and cross-member access denied as expected",
  );
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline && !fs.existsSync(".cache/gta-h3-live-stop")) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    fs.writeFileSync(
      ".cache/gta-h3-live-progress.json",
      JSON.stringify({
        roomCode,
        elapsedSeconds: (Date.now() - started) / 1000,
        snapshots,
        changes,
        completed,
        round: ticket.round,
        errors,
      }),
    );
    if (
      ticket.round?.completedAt &&
      Date.now() > ticket.round.completedAt + 5000
    )
      break;
  }
  clearInterval(frame);
  clearInterval(heartbeat);
  stopLoops();
  unsubscribe();
  const report = {
    environment:
      "Node 22 peer + real NextAuth HTTP + real Ably + isolated PostgreSQL; browser hosts initial room",
    elapsedSeconds: (Date.now() - started) / 1000,
    snapshots,
    receivedBytes: bytes,
    statePublishDenied,
    crossMemberStatus: denied.status,
    invalidSent,
    changes,
    completed: completed ?? ticket.round?.completedAt,
    errors,
  };
  fs.writeFileSync(
    "docs/tech/arena/audits/2026-09-12/live-service-results.json",
    JSON.stringify(report, null, 2),
  );
  await command({ action: "leave", memberId: ticket.memberId });
  transport.close();
  console.log(JSON.stringify(report));
  assert.equal(errors.length, 0);
}
void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
