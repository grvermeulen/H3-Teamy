import { describe, expect, it } from "vitest";
import { createArenaPlayer } from "../sim/roster";
import { createArenaObserver, emptyObserverState } from "./observerLoop";
import { createMemoryHub, createMemoryTransport } from "./memoryTransport";
import { encodeSnapshot } from "./snapshotWire";

describe("screen and controller observer", () => {
  it("accepts only the current host, rejects replays and never publishes", async () => {
    const hub = createMemoryHub();
    const client = createMemoryTransport(hub, "controller");
    const host = createMemoryTransport(hub, "host");
    const intruder = createMemoryTransport(hub, "intruder");
    const observer = createArenaObserver({
      transport: client,
      stateChannel: "state",
      hostClientId: "host",
      zone: "rhenen",
    });
    const state = {
      ...emptyObserverState("rhenen"),
      tick: 3,
      players: [createArenaPlayer([20, 10], 1)],
    };
    const snapshot = encodeSnapshot(state, 1000, {});
    await intruder.channel("state").publish("state", snapshot);
    hub.flush();
    expect(observer.state().players).toEqual([]);
    await host.channel("state").publish("state", snapshot);
    hub.flush();
    expect(observer.state().players[0]?.x).toBe(20);
    await host.channel("state").publish("state", { ...snapshot, t: 2 });
    hub.flush();
    expect(observer.state().tick).toBe(3);
    expect(hub.pending()).toBe(0);
    observer.stop();
    await host.channel("state").publish("state", { ...snapshot, t: 4 });
    hub.flush();
    expect(observer.state().tick).toBe(3);
  });
  it("waits for a missing keyframe, then interpolates between valid frames", async () => {
    const hub = createMemoryHub();
    const host = createMemoryTransport(hub, "host");
    const observer = createArenaObserver({
      transport: createMemoryTransport(hub, "screen"),
      stateChannel: "state",
      hostClientId: "host",
      zone: "rhenen",
    });
    const snapshot = (tick: number, x: number, at: number) =>
      encodeSnapshot(
        {
          ...emptyObserverState("rhenen"),
          tick,
          players: [createArenaPlayer([x, 0], 1)],
        },
        at,
        {},
      );
    await host
      .channel("state")
      .publish("state", { ...snapshot(3, 0, 1000), r: 0, x: [] });
    hub.flush();
    expect(observer.snapshot()).toBeNull();
    await host.channel("state").publish("state", snapshot(30, 0, 2000));
    hub.flush();
    await host.channel("state").publish("state", snapshot(33, 6, 2100));
    hub.flush();
    expect(observer.view(2170).players[0]?.x).toBeCloseTo(3);
    observer.stop();
  });
});
