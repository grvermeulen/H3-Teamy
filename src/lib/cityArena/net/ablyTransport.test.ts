import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresenceData } from "./transport";

const publish = vi.fn();
const subscribe = vi.fn();
const unsubscribe = vi.fn();
const detach = vi.fn();
const presenceEnter = vi.fn();
const presenceUpdate = vi.fn();
const presenceLeave = vi.fn();
const presenceGet = vi.fn();
const presenceSubscribe = vi.fn();
const presenceUnsubscribe = vi.fn();
const connectionOn = vi.fn();
const connectionOff = vi.fn();
const connectionOnce = vi.fn();
const channelsGet = vi.fn();
const time = vi.fn();
const close = vi.fn();
const captureException = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

let realtimeOptions: Record<string, unknown> = {};
vi.mock("ably", () => ({
  Realtime: class {
    constructor(options: Record<string, unknown>) {
      realtimeOptions = options;
    }
    connection = { on: connectionOn, off: connectionOff, once: connectionOnce };
    channels = { get: channelsGet };
    auth = { clientId: "user-1" };
    time = time;
    close = close;
  },
}));

const { createAblyTransport } = await import("./ablyTransport");

/** A signed token request, as the route returns one. */
const TOKEN_REQUEST = { keyName: "app.key", mac: "sig" };

const ANN: PresenceData = {
  name: "Ann",
  colour: "#f00",
  role: "player",
  device: "desktop",
};

describe("ablyTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelsGet.mockReturnValue({
      publish,
      subscribe,
      unsubscribe,
      detach,
      presence: {
        enter: presenceEnter,
        update: presenceUpdate,
        leave: presenceLeave,
        get: presenceGet,
        subscribe: presenceSubscribe,
        unsubscribe: presenceUnsubscribe,
      },
    });
    connectionOnce.mockResolvedValue(undefined);
    presenceGet.mockResolvedValue([]);
    time.mockResolvedValue(Date.now() + 5000);
  });

  it("reports the clientId from the token and an offset from Ably's clock", async () => {
    const transport = createAblyTransport();
    const { clientId, serverTimeOffsetMs } = await transport.connect();
    expect(clientId).toBe("user-1");
    expect(serverTimeOffsetMs).toBeGreaterThan(4000);
    expect(serverTimeOffsetMs).toBeLessThan(6000);
  });

  it("reports the display name from the token response, without asking again", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ tokenRequest: TOKEN_REQUEST, displayName: "Guido" }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = createAblyTransport();
    // The SDK asks for a token through the auth callback; drive that as Ably would.
    const authCallback = (
      Reflect.get(realtimeOptions, "authCallback") as (
        params: unknown,
        cb: (error: unknown, token: unknown) => void,
      ) => Promise<void>
    ).bind(null);
    await authCallback({}, () => {});
    const identity = await transport.connect();
    expect(identity.displayName).toBe("Guido");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("reports an empty name rather than inventing one before the token lands", async () => {
    const identity = await createAblyTransport().connect();
    expect(identity.displayName).toBe("");
  });

  it("shares one channel object per name", () => {
    const transport = createAblyTransport();
    expect(transport.channel("room")).toBe(transport.channel("room"));
    expect(channelsGet).toHaveBeenCalledTimes(1);
  });

  it("hands a subscriber the publisher, data and timestamp", () => {
    const transport = createAblyTransport();
    const seen: unknown[] = [];
    transport.channel("room").subscribe("input", (message) => {
      seen.push(message);
    });
    const listener = subscribe.mock.calls[0]?.[1] as (msg: unknown) => void;
    listener({ clientId: "b", data: [1], timestamp: 42 });
    expect(seen).toEqual([{ clientId: "b", data: [1], timestamp: 42 }]);
  });

  it("returns an unsubscribe that actually detaches the listener", () => {
    const transport = createAblyTransport();
    const stop = transport.channel("room").subscribe("input", () => {});
    stop();
    expect(unsubscribe).toHaveBeenCalledWith(
      "input",
      subscribe.mock.calls[0]?.[1],
    );
  });

  it("sorts presence members by their server timestamp", async () => {
    presenceGet.mockResolvedValue([
      { clientId: "b", data: ANN, timestamp: 20 },
      { clientId: "a", data: ANN, timestamp: 10 },
    ]);
    const members = await createAblyTransport().channel("room").presence.get();
    expect(members.map((member) => member.clientId)).toEqual(["a", "b"]);
  });

  it("maps Ably's presence actions onto the arena's three", () => {
    const transport = createAblyTransport();
    const seen: string[] = [];
    transport.channel("room").presence.subscribe((event) => {
      seen.push(event.action);
    });
    const listener = presenceSubscribe.mock.calls[0]?.[0] as (
      msg: unknown,
    ) => void;
    for (const action of ["enter", "present", "update", "leave", "absent"])
      listener({ action, clientId: "a", data: ANN, timestamp: 1 });
    expect(seen).toEqual(["enter", "enter", "update", "leave", "leave"]);
  });

  it("maps Ably's connection states onto the four the UI knows", () => {
    const transport = createAblyTransport();
    const seen: string[] = [];
    transport.onConnectionState((state) => {
      seen.push(state);
    });
    const listener = connectionOn.mock.calls[0]?.[0] as (
      change: unknown,
    ) => void;
    for (const current of [
      "connected",
      "connecting",
      "disconnected",
      "suspended",
      "closing",
      "closed",
      "failed",
    ])
      listener({ current });
    expect(seen).toEqual([
      "connected",
      "connecting",
      "connecting",
      "suspended",
      "suspended",
      "suspended",
      "failed",
    ]);
  });

  it("stops reporting connection state after the handler is released", () => {
    const transport = createAblyTransport();
    const stop = transport.onConnectionState(() => {});
    stop();
    expect(connectionOff).toHaveBeenCalledWith(connectionOn.mock.calls[0]?.[0]);
  });

  it("closes the underlying client", () => {
    const transport = createAblyTransport();
    transport.channel("room");
    transport.close();
    expect(close).toHaveBeenCalled();
  });
});
