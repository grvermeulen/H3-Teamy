/**
 * An in-process {@link RealtimeTransport}, used by every netcode test.
 *
 * It is not a mock: ordering, presence and the no-echo rule behave as Ably does, so the host and
 * client loops are exercised for real. Two things are deliberately different, and both exist to
 * make tests deterministic — delivery happens on {@link MemoryHub.flush} rather than whenever a
 * microtask runs, and timestamps come from a counter the hub owns rather than from `Date.now()`.
 */

import type {
  ConnectionState,
  PresenceData,
  PresenceEvent,
  PresenceMember,
  RealtimeTransport,
  TransportChannel,
  TransportIdentity,
  TransportMessage,
} from "./transport";

/** How the hub may distort delivery, so loss and lag can be tested. */
export type MemoryHubOptions = {
  /** Share of messages to drop, 0 to 1. Uses `random`, so a run is reproducible. */
  dropRate?: number;
  /** Flushes to hold a message back for, modelling latency. */
  latencyFlushes?: number;
  /** The randomness `dropRate` draws on; inject one for a reproducible test. */
  random?: () => number;
};

type Subscriber = {
  clientId: string;
  name: string;
  handler: (message: TransportMessage) => void;
};

type PresenceSubscriber = {
  clientId: string;
  handler: (event: PresenceEvent) => void;
};

type Queued = {
  channel: string;
  name: string;
  from: string;
  data: unknown;
  timestamp: number;
  dueAfter: number;
};

type ChannelState = {
  subscribers: Subscriber[];
  presenceSubscribers: PresenceSubscriber[];
  members: Map<string, PresenceMember>;
};

/** The shared bus every transport on it publishes into. */
export type MemoryHub = {
  /** Delivers every message now due. Call it after publishing, and once per simulated tick. */
  flush(): void;
  /** Pushes a connection state to one client's handlers. */
  setConnectionState(clientId: string, state: ConnectionState): void;
  /** How many messages are waiting; a test asserting on delivery can check this is drained. */
  pending(): number;
  /** @internal — the transports on this hub use these. */
  readonly internals: HubInternals;
};

type HubInternals = {
  channel(name: string): ChannelState;
  nextTimestamp(): number;
  enqueue(message: Queued): void;
  connectionHandlers: Map<string, ((state: ConnectionState) => void)[]>;
  closed: Set<string>;
  shouldDrop(): boolean;
  latencyFlushes: number;
};

/**
 * Creates a bus for in-process transports.
 *
 * @param options - Optional loss and latency, for tests that need an unreliable network.
 * @returns The hub to hand to {@link createMemoryTransport}.
 */
export function createMemoryHub(options: MemoryHubOptions = {}): MemoryHub {
  const channels = new Map<string, ChannelState>();
  const queue: Queued[] = [];
  const connectionHandlers = new Map<
    string,
    ((state: ConnectionState) => void)[]
  >();
  const closed = new Set<string>();
  const dropRate = options.dropRate ?? 0;
  const random = options.random ?? Math.random;
  let clock = 0;
  let flushes = 0;

  const internals: HubInternals = {
    channel(name: string): ChannelState {
      const existing = channels.get(name);
      if (existing) return existing;
      const created: ChannelState = {
        subscribers: [],
        presenceSubscribers: [],
        members: new Map(),
      };
      channels.set(name, created);
      return created;
    },
    nextTimestamp(): number {
      clock += 1;
      return clock;
    },
    enqueue(message: Queued): void {
      queue.push(message);
    },
    connectionHandlers,
    closed,
    shouldDrop(): boolean {
      return dropRate > 0 && random() < dropRate;
    },
    latencyFlushes: options.latencyFlushes ?? 0,
  };

  return {
    flush(): void {
      flushes += 1;
      const due = queue.filter((message) => message.dueAfter <= flushes);
      queue.length = 0;
      queue.push(...due.filter((message) => message.dueAfter > flushes));
      for (const message of due) {
        const channel = channels.get(message.channel);
        if (!channel) continue;
        for (const subscriber of [...channel.subscribers]) {
          if (subscriber.name !== message.name) continue;
          if (subscriber.clientId === message.from) continue;
          if (closed.has(subscriber.clientId)) continue;
          subscriber.handler({
            clientId: message.from,
            data: message.data,
            timestamp: message.timestamp,
          });
        }
      }
    },
    setConnectionState(clientId: string, state: ConnectionState): void {
      for (const handler of connectionHandlers.get(clientId) ?? [])
        handler(state);
    },
    pending(): number {
      return queue.length;
    },
    internals,
  };
}

/** Tells every watcher but the mover about a presence change. */
function broadcastPresence(
  channel: ChannelState,
  closedClients: Set<string>,
  event: PresenceEvent,
): void {
  for (const subscriber of [...channel.presenceSubscribers]) {
    if (subscriber.clientId === event.member.clientId) continue;
    if (closedClients.has(subscriber.clientId)) continue;
    subscriber.handler(event);
  }
}

/** One client's view of a channel on the hub. */
function memoryChannel(
  hub: MemoryHub,
  clientId: string,
  name: string,
): TransportChannel {
  const internals = hub.internals;
  const state = internals.channel(name);

  return {
    async publish(messageName: string, data: unknown): Promise<void> {
      if (internals.closed.has(clientId)) return;
      if (internals.shouldDrop()) return;
      internals.enqueue({
        channel: name,
        name: messageName,
        from: clientId,
        data,
        timestamp: internals.nextTimestamp(),
        dueAfter: internals.latencyFlushes,
      });
    },
    subscribe(
      messageName: string,
      handler: (message: TransportMessage) => void,
    ): () => void {
      const subscriber: Subscriber = { clientId, name: messageName, handler };
      state.subscribers.push(subscriber);
      return () => {
        const at = state.subscribers.indexOf(subscriber);
        if (at >= 0) state.subscribers.splice(at, 1);
      };
    },
    presence: {
      async enter(data: PresenceData): Promise<void> {
        const member: PresenceMember = {
          clientId,
          data,
          timestamp: internals.nextTimestamp(),
        };
        state.members.set(clientId, member);
        broadcastPresence(state, internals.closed, { action: "enter", member });
      },
      async update(data: PresenceData): Promise<void> {
        const current = state.members.get(clientId);
        if (!current) return;
        const member: PresenceMember = { ...current, data };
        state.members.set(clientId, member);
        broadcastPresence(state, internals.closed, {
          action: "update",
          member,
        });
      },
      async leave(): Promise<void> {
        const member = state.members.get(clientId);
        if (!member) return;
        state.members.delete(clientId);
        broadcastPresence(state, internals.closed, { action: "leave", member });
      },
      async get(): Promise<PresenceMember[]> {
        return [...state.members.values()].sort(
          (first, second) => first.timestamp - second.timestamp,
        );
      },
      subscribe(handler: (event: PresenceEvent) => void): () => void {
        const subscriber: PresenceSubscriber = { clientId, handler };
        state.presenceSubscribers.push(subscriber);
        return () => {
          const at = state.presenceSubscribers.indexOf(subscriber);
          if (at >= 0) state.presenceSubscribers.splice(at, 1);
        };
      },
    },
    async detach(): Promise<void> {
      state.subscribers = state.subscribers.filter(
        (subscriber) => subscriber.clientId !== clientId,
      );
      state.presenceSubscribers = state.presenceSubscribers.filter(
        (subscriber) => subscriber.clientId !== clientId,
      );
      state.members.delete(clientId);
    },
  };
}

/**
 * Creates one client's transport on a hub.
 *
 * @param hub - The bus shared with every other client in the test.
 * @param clientId - This client's id, which is also its presence and publisher identity.
 * @param displayName - The name `connect` reports; defaults to the client id.
 * @returns A transport that behaves like the Ably one, minus the network.
 */
export function createMemoryTransport(
  hub: MemoryHub,
  clientId: string,
  displayName = clientId,
): RealtimeTransport {
  const channels = new Map<string, TransportChannel>();

  return {
    async connect(): Promise<TransportIdentity> {
      hub.internals.closed.delete(clientId);
      return { clientId, displayName, serverTimeOffsetMs: 0 };
    },
    channel(name: string): TransportChannel {
      const existing = channels.get(name);
      if (existing) return existing;
      const created = memoryChannel(hub, clientId, name);
      channels.set(name, created);
      return created;
    },
    onConnectionState(handler: (state: ConnectionState) => void): () => void {
      const handlers = hub.internals.connectionHandlers.get(clientId) ?? [];
      handlers.push(handler);
      hub.internals.connectionHandlers.set(clientId, handlers);
      return () => {
        const at = handlers.indexOf(handler);
        if (at >= 0) handlers.splice(at, 1);
      };
    },
    close(): void {
      hub.internals.closed.add(clientId);
      for (const channel of channels.values()) void channel.detach();
      channels.clear();
    },
  };
}
