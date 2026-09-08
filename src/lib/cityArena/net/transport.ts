/**
 * The seam between the arena and whatever carries its messages (spec §6.1).
 *
 * Production talks to Ably; Vitest talks to an in-process hub. Nothing above this file knows
 * which, so the host loop, the client loop and election are all testable with no network at all.
 */

/** How a member is taking part, which also sets their host priority (spec §6.6). */
export type PresenceRole = "player" | "controller" | "display";

/**
 * A room as it appears in the lobby's presence set (spec §6.3).
 *
 * Only the host of a room publishes one, and only onto `arena:lobby`. It is what the launcher's
 * "Actieve potjes" list is built from.
 */
export type LobbyRoomSummary = {
  roomCode: string;
  zone: string;
  players: number;
  phase: "lobby" | "playing";
};

/** What every member publishes about themselves into a channel's presence set. */
export type PresenceData = {
  name: string;
  colour: string;
  role: PresenceRole;
  device: "mobile" | "desktop";
  displayId?: string;
  /** Set only on `arena:lobby`, by the host, to advertise the room it is running. */
  room?: LobbyRoomSummary;
};

/**
 * A member currently present. `timestamp` comes from the server, never from a client clock —
 * it is what fixes join order, and therefore who hosts (spec §6.3).
 */
export type PresenceMember = {
  clientId: string;
  data: PresenceData;
  timestamp: number;
};

/** A presence change: someone entered, changed their data, or left. */
export type PresenceEvent = {
  action: "enter" | "update" | "leave";
  member: PresenceMember;
};

/** One message as a subscriber receives it. */
export type TransportMessage = {
  clientId: string;
  data: unknown;
  timestamp: number;
};

/** Connection states the UI reacts to; spec §16 gives the Dutch copy for each. */
export type ConnectionState =
  "connected" | "connecting" | "suspended" | "failed";

/** The presence set of one channel. */
export type TransportPresence = {
  /** Announces this member, with the data every other member will see. */
  enter(data: PresenceData): Promise<void>;
  /** Replaces this member's data, keeping the timestamp that fixed their join order. */
  update(data: PresenceData): Promise<void>;
  /** Removes this member from the set. */
  leave(): Promise<void>;
  /** Everyone currently present, in join order. */
  get(): Promise<PresenceMember[]>;
  /** Watches presence changes; returns the function that stops watching. */
  subscribe(handler: (event: PresenceEvent) => void): () => void;
};

/** One named channel: messages in both directions plus a presence set. */
export type TransportChannel = {
  /** Sends one message to every other member. The publisher never receives its own. */
  publish(name: string, data: unknown): Promise<void>;
  /** Watches messages of one name; returns the function that stops watching. */
  subscribe(
    name: string,
    handler: (message: TransportMessage) => void,
  ): () => void;
  presence: TransportPresence;
  /** Leaves the channel and releases its resources. */
  detach(): Promise<void>;
};

/** What the arena needs from a realtime service. */
export type RealtimeTransport = {
  /** Connects and reports this client's id and how far its clock sits from the server's. */
  connect(): Promise<{ clientId: string; serverTimeOffsetMs: number }>;
  /** The named channel, created on first use and shared afterwards. */
  channel(name: string): TransportChannel;
  /** Watches the connection state; returns the function that stops watching. */
  onConnectionState(handler: (state: ConnectionState) => void): () => void;
  /** Disconnects and drops every subscription. */
  close(): void;
};
