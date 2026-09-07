import { describe, expect, it } from "vitest";
import { createMemoryHub, createMemoryTransport } from "./memoryTransport";
import type { PresenceData } from "./transport";

const ANN: PresenceData = {
  name: "Ann",
  colour: "#f00",
  role: "player",
  device: "desktop",
};
const BO: PresenceData = {
  name: "Bo",
  colour: "#0f0",
  role: "player",
  device: "mobile",
};

/** Two connected transports on one hub, the pair every test here starts from. */
async function pair() {
  const hub = createMemoryHub();
  const first = createMemoryTransport(hub, "a");
  const second = createMemoryTransport(hub, "b");
  await first.connect();
  await second.connect();
  return { hub, first, second };
}

describe("memoryTransport messages", () => {
  it("delivers a published message to every other subscriber, in order", async () => {
    const { hub, first, second } = await pair();
    const seen: unknown[] = [];
    second.channel("room").subscribe("input", (message) => {
      seen.push(message.data);
    });
    await first.channel("room").publish("input", [1]);
    await first.channel("room").publish("input", [2]);
    hub.flush();
    expect(seen).toEqual([[1], [2]]);
  });

  it("never echoes a message back to its publisher", async () => {
    const { hub, first } = await pair();
    const seen: unknown[] = [];
    first.channel("room").subscribe("input", (message) => {
      seen.push(message.data);
    });
    await first.channel("room").publish("input", [1]);
    hub.flush();
    expect(seen).toEqual([]);
  });

  it("keeps channels apart and stops delivering after unsubscribe", async () => {
    const { hub, first, second } = await pair();
    const room: unknown[] = [];
    const lobby: unknown[] = [];
    const stop = second.channel("room").subscribe("input", (message) => {
      room.push(message.data);
    });
    second.channel("lobby").subscribe("input", (message) => {
      lobby.push(message.data);
    });
    await first.channel("room").publish("input", [1]);
    hub.flush();
    stop();
    await first.channel("room").publish("input", [2]);
    hub.flush();
    expect(room).toEqual([[1]]);
    expect(lobby).toEqual([]);
  });

  it("tags every message with the publisher and a hub timestamp", async () => {
    const { hub, first, second } = await pair();
    const seen: { clientId: string; timestamp: number }[] = [];
    second.channel("room").subscribe("input", (message) => {
      seen.push({ clientId: message.clientId, timestamp: message.timestamp });
    });
    await first.channel("room").publish("input", [1]);
    hub.flush();
    expect(seen[0]?.clientId).toBe("a");
    expect(Number.isInteger(seen[0]?.timestamp)).toBe(true);
  });

  it("drops a share of messages when the hub is told to, reproducibly", async () => {
    const seenPerRun: number[] = [];
    for (let run = 0; run < 2; run += 1) {
      let seed = 1;
      const hub = createMemoryHub({
        dropRate: 0.5,
        random: () => {
          seed = (seed * 1664525 + 1013904223) % 4294967296;
          return seed / 4294967296;
        },
      });
      const sender = createMemoryTransport(hub, "a");
      const receiver = createMemoryTransport(hub, "b");
      await sender.connect();
      await receiver.connect();
      let seen = 0;
      receiver.channel("room").subscribe("input", () => {
        seen += 1;
      });
      for (let index = 0; index < 40; index += 1)
        await sender.channel("room").publish("input", [index]);
      hub.flush();
      seenPerRun.push(seen);
    }
    expect(seenPerRun[0]).toBeGreaterThan(0);
    expect(seenPerRun[0]).toBeLessThan(40);
    expect(seenPerRun[1]).toBe(seenPerRun[0]);
  });
});

describe("memoryTransport presence", () => {
  it("reports members in the order they entered", async () => {
    const { first, second } = await pair();
    await first.channel("room").presence.enter(ANN);
    await second.channel("room").presence.enter(BO);
    const members = await first.channel("room").presence.get();
    expect(members.map((member) => member.clientId)).toEqual(["a", "b"]);
    expect(members[0]!.timestamp).toBeLessThanOrEqual(members[1]!.timestamp);
  });

  it("tells other members about enter, update and leave", async () => {
    const { hub, first, second } = await pair();
    const events: string[] = [];
    first.channel("room").presence.subscribe((event) => {
      events.push(`${event.action}:${event.member.clientId}`);
    });
    await second.channel("room").presence.enter(BO);
    await second.channel("room").presence.update({ ...BO, name: "Bo!" });
    await second.channel("room").presence.leave();
    hub.flush();
    expect(events).toEqual(["enter:b", "update:b", "leave:b"]);
  });

  it("drops a member from the set when they leave", async () => {
    const { first, second } = await pair();
    await first.channel("room").presence.enter(ANN);
    await second.channel("room").presence.enter(BO);
    await second.channel("room").presence.leave();
    const members = await first.channel("room").presence.get();
    expect(members.map((member) => member.clientId)).toEqual(["a"]);
  });

  it("keeps the entry timestamp when a member updates their data", async () => {
    const { first } = await pair();
    await first.channel("room").presence.enter(ANN);
    const entered = (await first.channel("room").presence.get())[0]!.timestamp;
    await first.channel("room").presence.update({ ...ANN, name: "Ann!" });
    const after = (await first.channel("room").presence.get())[0]!;
    expect(after.timestamp).toBe(entered);
    expect(after.data.name).toBe("Ann!");
  });
});

describe("memoryTransport connection", () => {
  it("reports a clientId and a zero clock offset", async () => {
    const hub = createMemoryHub();
    const transport = createMemoryTransport(hub, "a");
    expect(await transport.connect()).toEqual({
      clientId: "a",
      serverTimeOffsetMs: 0,
    });
  });

  it("passes connection state changes to its handler", async () => {
    const { hub, first } = await pair();
    const states: string[] = [];
    first.onConnectionState((state) => {
      states.push(state);
    });
    hub.setConnectionState("a", "suspended");
    hub.setConnectionState("a", "connected");
    expect(states).toEqual(["suspended", "connected"]);
  });

  it("stops delivering to a closed transport", async () => {
    const { hub, first, second } = await pair();
    const seen: unknown[] = [];
    second.channel("room").subscribe("input", (message) => {
      seen.push(message.data);
    });
    second.close();
    await first.channel("room").publish("input", [1]);
    hub.flush();
    expect(seen).toEqual([]);
  });
});
