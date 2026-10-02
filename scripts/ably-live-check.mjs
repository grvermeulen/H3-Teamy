/**
 * Live check against a real Ably app — the things a stubbed SDK cannot answer.
 *
 * The unit tests for the token route and the Ably transport mock the SDK, which pins our reading
 * of Ably's contract but cannot confirm Ably behaves that way. This does:
 *
 *   1. does `createTokenRequest` accept the capability the token route asks for?
 *   2. does a Realtime connection open with that token, carrying our clientId?
 *   3. does `arena:room:*` actually cover `arena:room:<code>:inputs`, four segments deep?
 *   4. is `arena:lobby` genuinely read-only for a member — presence yes, publish no?
 *
 * Run it after changing ARENA_CAPABILITY in the token route, or when rotating the API key.
 *
 *   ABLY_API_KEY=... node scripts/ably-live-check.mjs
 *   node scripts/ably-live-check.mjs .env        # or read it from an env file
 *
 * It never prints the key. It publishes a handful of messages to a throwaway room, which is
 * negligible against the message quota.
 */
import Ably from "ably";
import { existsSync, readFileSync } from "node:fs";

/** Reads one variable out of a dotenv-style file, without printing anything from it. */
function readKeyFrom(file) {
  if (!existsSync(file)) return undefined;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^ABLY_API_KEY="?(.*?)"?$/.exec(raw.trim());
    if (match && match[1]) return match[1];
  }
  return undefined;
}

const envFile = process.argv[2];
const key =
  process.env.ABLY_API_KEY || (envFile ? readKeyFrom(envFile) : undefined);
if (!key) {
  console.error(
    "No ABLY_API_KEY. Set it in the environment, or pass an env file: node scripts/ably-live-check.mjs .env",
  );
  process.exit(1);
}

/** One hour, matching the token route (spec §6.2). */
const TOKEN_TTL_MS = 60 * 60 * 1000;
/** Kept in step with ARENA_CAPABILITY in src/app/api/arena/realtime-token/route.ts. */
const ARENA_CAPABILITY = {
  "arena:room:*": ["publish", "subscribe", "presence"],
  "arena:lobby": ["subscribe", "presence"],
};
/** A throwaway room; nothing else uses this code. */
const CODE = "LIVE24";
/** How long to wait for a published message to come back before calling it lost. */
const RECEIVE_TIMEOUT_MS = 8000;

const results = [];
const note = (ok, text) => results.push(`${ok ? "PASS" : "FAIL"}  ${text}`);

let realtime;
try {
  const rest = new Ably.Rest({ key });
  const tokenParams = {
    clientId: "live-check-user",
    ttl: TOKEN_TTL_MS,
    capability: ARENA_CAPABILITY,
  };

  const tokenRequest = await rest.auth.createTokenRequest(tokenParams);
  note(
    typeof tokenRequest.mac === "string" && tokenRequest.mac.length > 0,
    "createTokenRequest signed a request with the arena capability",
  );
  note(
    tokenRequest.clientId === tokenParams.clientId,
    `token carries our clientId (${tokenRequest.clientId})`,
  );

  realtime = new Ably.Realtime({
    authCallback: async (_params, callback) => {
      try {
        callback(null, await rest.auth.createTokenRequest(tokenParams));
      } catch (error) {
        callback(String(error), null);
      }
    },
  });
  await realtime.connection.once("connected");
  note(true, "Realtime connection opened with a token from that capability");
  note(
    realtime.auth.clientId === tokenParams.clientId,
    `connection identifies as our clientId (${realtime.auth.clientId})`,
  );

  const serverTimeMs = await realtime.time();
  note(
    Number.isFinite(serverTimeMs) && serverTimeMs > 0,
    `client.time() returned server time (offset ${serverTimeMs - Date.now()} ms)`,
  );

  const room = realtime.channels.get(`arena:room:${CODE}`);
  const delivered = new Promise((resolve) => {
    room.subscribe("state", (message) => resolve(message.data));
  });
  await room.publish("state", { t: 1 });
  const received = await Promise.race([
    delivered,
    new Promise((resolve) =>
      setTimeout(() => resolve("TIMEOUT"), RECEIVE_TIMEOUT_MS),
    ),
  ]);
  note(
    received !== "TIMEOUT" && received?.t === 1,
    "published and received on arena:room:<code>",
  );

  await room.presence.enter({
    name: "live",
    role: "player",
    device: "desktop",
  });
  const members = await room.presence.get();
  note(
    members.some((member) => member.clientId === tokenParams.clientId),
    `presence enter worked (${members.length} member(s))`,
  );

  // The one a stub cannot answer: is the wildcard one segment deep, or all of them?
  const inputs = realtime.channels.get(`arena:room:${CODE}:inputs`);
  try {
    await inputs.publish("input", [1, 0, 0, -1, 0]);
    note(true, "arena:room:* covers arena:room:<code>:inputs (4 segments)");
  } catch (error) {
    note(
      false,
      `arena:room:* does NOT cover the inputs channel — ${error?.message ?? error}`,
    );
  }

  const lobby = realtime.channels.get("arena:lobby");
  await lobby.presence.enter({ name: "live" });
  note(true, "arena:lobby presence enter worked");
  try {
    await lobby.publish("nope", {});
    note(false, "arena:lobby publish was ALLOWED — the capability is too wide");
  } catch {
    // Expected: error 40160. This is what stops a member forging a room into the lobby list.
    note(true, "arena:lobby publish correctly refused");
  }

  await room.presence.leave();
  await lobby.presence.leave();
} catch (error) {
  note(false, `threw: ${error?.message ?? error}`);
} finally {
  realtime?.close();
}

console.log(results.join("\n"));
process.exit(results.some((line) => line.startsWith("FAIL")) ? 1 : 0);
