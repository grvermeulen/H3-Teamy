/**
 * The production {@link RealtimeTransport}, on Ably (spec §6.2).
 *
 * Deliberately thin: it translates Ably's shapes into the interface and does nothing else. No game
 * logic, no retry policy of its own — Ably already reconnects, and anything cleverer here would be
 * logic the in-memory transport does not have, which is exactly the divergence the seam exists to
 * prevent.
 */

import * as Ably from "ably";
import * as Sentry from "@sentry/nextjs";
import type {
  ConnectionState,
  PresenceData,
  PresenceEvent,
  PresenceMember,
  RealtimeTransport,
  TransportChannel,
  TransportMessage,
} from "./transport";

/** Where the browser fetches its short-lived token request (spec §6.2). */
const DEFAULT_AUTH_URL = "/api/arena/realtime-token";

/** How the arena is configured against Ably. */
export type AblyTransportOptions = {
  /** The token endpoint; the default is the app's own route. */
  authUrl?: string;
};

/** Ably states the arena does not distinguish, mapped onto the four the UI knows. */
function toConnectionState(state: Ably.ConnectionState): ConnectionState {
  if (state === "connected") return "connected";
  if (state === "failed") return "failed";
  if (state === "suspended" || state === "closed" || state === "closing")
    return "suspended";
  return "connecting";
}

/** An Ably presence message as the arena's {@link PresenceMember}. */
function toMember(message: Ably.PresenceMessage): PresenceMember {
  return {
    clientId: message.clientId,
    data: message.data as PresenceData,
    timestamp: message.timestamp,
  };
}

/** An Ably presence action as the arena's three. */
function toPresenceAction(
  action: Ably.PresenceAction,
): PresenceEvent["action"] {
  if (action === "leave" || action === "absent") return "leave";
  if (action === "update") return "update";
  return "enter";
}

/** Wraps one Ably channel in the arena's interface. */
function wrapChannel(channel: Ably.RealtimeChannel): TransportChannel {
  return {
    async publish(name: string, data: unknown): Promise<void> {
      await channel.publish(name, data);
    },
    subscribe(
      name: string,
      handler: (message: TransportMessage) => void,
    ): () => void {
      const listener = (message: Ably.InboundMessage): void => {
        handler({
          clientId: message.clientId ?? "",
          data: message.data,
          timestamp: message.timestamp ?? 0,
        });
      };
      void channel.subscribe(name, listener);
      return () => {
        channel.unsubscribe(name, listener);
      };
    },
    presence: {
      async enter(data: PresenceData): Promise<void> {
        await channel.presence.enter(data);
      },
      async update(data: PresenceData): Promise<void> {
        await channel.presence.update(data);
      },
      async leave(): Promise<void> {
        await channel.presence.leave();
      },
      async get(): Promise<PresenceMember[]> {
        const members = await channel.presence.get();
        return members
          .map(toMember)
          .sort((first, second) => first.timestamp - second.timestamp);
      },
      subscribe(handler: (event: PresenceEvent) => void): () => void {
        const listener = (message: Ably.PresenceMessage): void => {
          handler({
            action: toPresenceAction(message.action),
            member: toMember(message),
          });
        };
        void channel.presence.subscribe(listener);
        return () => {
          channel.presence.unsubscribe(listener);
        };
      },
    },
    async detach(): Promise<void> {
      await channel.detach();
    },
  };
}

/** What Ably hands the auth callback to report a token or a failure. */
type AuthResult = (
  error: Ably.ErrorInfo | string | null,
  tokenRequestOrDetails: Ably.TokenRequest | null,
) => void;

/** Fetches a token request from the app's own endpoint, so the API key stays on the server. */
function tokenCallback(
  authUrl: string,
): (params: Ably.TokenParams, callback: AuthResult) => void {
  return async (_params: Ably.TokenParams, callback: AuthResult) => {
    try {
      const response = await fetch(authUrl);
      if (!response.ok)
        throw new Error(`realtime-token responded ${response.status}`);
      const body = (await response.json()) as { tokenRequest: unknown };
      callback(null, body.tokenRequest as Ably.TokenRequest);
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { area: "arena", kind: "realtime-auth" },
      });
      callback(error instanceof Error ? error.message : String(error), null);
    }
  };
}

/**
 * Connects the arena to Ably.
 *
 * @param options - Where to fetch tokens from; the default is this app's own route.
 * @returns A transport over a real Ably connection.
 */
export function createAblyTransport(
  options: AblyTransportOptions = {},
): RealtimeTransport {
  const client = new Ably.Realtime({
    authCallback: tokenCallback(options.authUrl ?? DEFAULT_AUTH_URL),
  });
  const channels = new Map<string, TransportChannel>();

  return {
    async connect(): Promise<{ clientId: string; serverTimeOffsetMs: number }> {
      await client.connection.once("connected");
      const serverTimeMs = await client.time();
      return {
        clientId: client.auth.clientId ?? "",
        serverTimeOffsetMs: serverTimeMs - Date.now(),
      };
    },
    channel(name: string): TransportChannel {
      const existing = channels.get(name);
      if (existing) return existing;
      const created = wrapChannel(client.channels.get(name));
      channels.set(name, created);
      return created;
    },
    onConnectionState(handler: (state: ConnectionState) => void): () => void {
      const listener = (change: Ably.ConnectionStateChange): void => {
        handler(toConnectionState(change.current));
      };
      client.connection.on(listener);
      return () => {
        client.connection.off(listener);
      };
    },
    close(): void {
      client.close();
      channels.clear();
    },
  };
}
