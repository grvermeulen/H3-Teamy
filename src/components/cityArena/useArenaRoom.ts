"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import {
  createAblyTransport,
  type AblyTransportOptions,
} from "@/lib/cityArena/net/ablyTransport";
import {
  ArenaRequestError,
  sendArenaRoomCommand,
  type ArenaRoomClient,
} from "@/lib/cityArena/net/roomClient";
import {
  ROOM_RULES,
  arenaChannels,
  type ArenaRoomTicket,
} from "@/lib/cityArena/net/roomProtocol";
import type {
  ConnectionState,
  RealtimeTransport,
} from "@/lib/cityArena/net/transport";
import type { ZoneKey } from "@/lib/cityArena/world/mapTypes";
import type { CrewMember } from "./ArenaLobby";
import type { ArenaEntry } from "./arenaEntry";

/** The session-approved room and actions available to the overlay. */
export type ArenaRoom = {
  status: "connecting" | "ready" | "failed";
  connection: ConnectionState;
  roomCode: string | null;
  clientId: string;
  clockOffsetMs: number;
  transport: () => RealtimeTransport | null;
  zone: ZoneKey;
  crew: CrewMember[];
  hostClientId: string | null;
  isHost: boolean;
  failure: string | null;
  ticket: ArenaRoomTicket | null;
  startRound: () => Promise<ArenaRoomTicket>;
  reportHostLost: (clientId: string) => void;
};

/** Network seams for integration tests; production always calls the authenticated room API. */
export type UseArenaRoomOptions = {
  entry: ArenaEntry;
  fallbackZone: ZoneKey;
  createTransport?: (options?: AblyTransportOptions) => RealtimeTransport;
  roomClient?: ArenaRoomClient;
};

function reportFailure(error: unknown): void {
  if (error instanceof ArenaRequestError && error.status < 500) return;
  Sentry.captureException(error, {
    tags: { area: "arena", kind: "room-session" },
  });
}

/** Connects only after membership approval and follows server-issued host epochs. */
export function useArenaRoom(
  options: UseArenaRoomOptions,
): ArenaRoom & { leave: () => void } {
  const [ticket, setTicket] = useState<ArenaRoomTicket | null>(null);
  const [status, setStatus] = useState<ArenaRoom["status"]>("connecting");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [failure, setFailure] = useState<string | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const transportRef = useRef<RealtimeTransport | null>(null);
  const ticketRef = useRef<ArenaRoomTicket | null>(null);
  const pulseRef = useRef<(() => void) | null>(null);
  const leaveRef = useRef<(() => void) | null>(null);
  const startRef = useRef<(() => Promise<ArenaRoomTicket>) | null>(null);
  const unwillingUntilRef = useRef(0);

  useEffect(() => {
    const send = options.roomClient ?? sendArenaRoomCommand;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let queued = false;
    let wireConnected = false;
    let stopState: (() => void) | undefined;
    const joinNonce = crypto.randomUUID();
    const initialZone =
      options.entry.kind === "code" ? options.fallbackZone : options.entry.zone;
    const release = (memberId: string): void => {
      void send({ action: "leave", memberId }, true).catch(reportFailure);
    };
    const apply = async (next: ArenaRoomTicket): Promise<ArenaRoomTicket> => {
      const previous = ticketRef.current;
      if (previous && next.serverTime < previous.serverTime) return previous;
      if (previous && previous.epoch !== next.epoch && transportRef.current) {
        setStatus("connecting");
        next = (await transportRef.current.refreshAuth?.()) ?? next;
      }
      if (
        ticketRef.current &&
        (next.epoch < ticketRef.current.epoch ||
          next.serverTime < ticketRef.current.serverTime)
      )
        return ticketRef.current;
      if (!disposed) {
        ticketRef.current = next;
        setTicket(next);
        setStatus("ready");
        setFailure(null);
      }
      return next;
    };
    const pulse = async (): Promise<void> => {
      if (disposed || !ticketRef.current) return;
      if (busy) {
        queued = true;
        return;
      }
      busy = true;
      clearTimeout(timer);
      try {
        const next = await send({
          action: "heartbeat",
          memberId: ticketRef.current.memberId,
          visible:
            wireConnected &&
            document.visibilityState !== "hidden" &&
            Date.now() >= unwillingUntilRef.current,
        });
        if (next) await apply(next);
      } catch (error: unknown) {
        reportFailure(error);
        if (!disposed) {
          setStatus(
            error instanceof ArenaRequestError && error.status < 500
              ? "failed"
              : "connecting",
          );
          setFailure(
            error instanceof Error
              ? error.message
              : "De verbinding is even weg",
          );
        }
      } finally {
        busy = false;
        if (!disposed) {
          timer = setTimeout(
            () => {
              void pulse();
            },
            queued ? 0 : ROOM_RULES.heartbeatMs,
          );
          queued = false;
        }
      }
    };
    pulseRef.current = () => {
      void pulse();
    };
    const visibilityChanged = (): void => {
      void pulse();
    };
    document.addEventListener("visibilitychange", visibilityChanged);

    const stop = (): void => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      stopState?.();
      const current = ticketRef.current;
      ticketRef.current = null;
      if (current) release(current.memberId);
      transportRef.current?.close();
      transportRef.current = null;
    };
    leaveRef.current = stop;
    startRef.current = async () => {
      const current = ticketRef.current;
      if (!current || disposed)
        throw new ArenaRequestError("Je bent nog niet verbonden", 409);
      const next = await send({
        action: "start",
        memberId: current.memberId,
        epoch: current.epoch,
      });
      if (!next) throw new Error("Missing match ticket");
      return apply(next);
    };

    const connect = async (): Promise<void> => {
      const first = await send(
        options.entry.kind === "join"
          ? { action: "join", roomCode: options.entry.roomCode, joinNonce }
          : { action: "create", zone: initialZone, joinNonce },
      );
      if (!first) throw new Error("Missing room ticket");
      if (disposed) {
        release(first.memberId);
        return;
      }
      ticketRef.current = first;
      const transport = (options.createTransport ?? createAblyTransport)({
        authUrl:
          "/api/arena/realtime-token?memberId=" +
          encodeURIComponent(first.memberId),
      });
      transportRef.current = transport;
      stopState = transport.onConnectionState((state) => {
        wireConnected = state === "connected";
        if (!disposed) {
          setConnection(state);
          if (ticketRef.current) void pulse();
        }
      });
      const identity = await transport.connect();
      if (disposed) return;
      wireConnected = true;
      setClockOffsetMs(identity.serverTimeOffsetMs);
      if (identity.clientId !== first.memberId)
        throw new Error(
          "Arena transport identity does not match the approved seat",
        );
      await transport
        .channel(arenaChannels(first.roomId, first.epoch).presence)
        .presence.enter({
          name: identity.displayName,
          colour: "#f5a524",
          role: "player",
          device: window.matchMedia("(pointer: coarse)").matches
            ? "mobile"
            : "desktop",
        });
      if (disposed) return;
      setConnection("connected");
      await apply(first);
      await pulse();
    };
    // React may clean up and replay setup before the first microtask; do not create an abandoned seat.
    void Promise.resolve()
      .then(() => (disposed ? undefined : connect()))
      .catch((error: unknown) => {
        reportFailure(error);
        if (!disposed) {
          setStatus("failed");
          setConnection("failed");
          setFailure(
            error instanceof Error
              ? error.message
              : "Het potje is even niet beschikbaar",
          );
          stop();
        }
      });
    return stop;
    // The selected entry remains fixed for the lifetime of this overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transport = useCallback(() => transportRef.current, []);
  const leave = useCallback(() => leaveRef.current?.(), []);
  const startRound = useCallback(async (): Promise<ArenaRoomTicket> => {
    if (!startRef.current)
      throw new ArenaRequestError("Je bent nog niet verbonden", 409);
    return startRef.current();
  }, []);
  const reportHostLost = useCallback((clientId: string) => {
    if (clientId === ticketRef.current?.memberId)
      unwillingUntilRef.current = Date.now() + ROOM_RULES.hostLeaseMs;
    pulseRef.current?.();
  }, []);
  const hostClientId = ticket?.hostClientId ?? null;
  return {
    status,
    connection,
    ticket,
    transport,
    leave,
    startRound,
    reportHostLost,
    failure,
    clockOffsetMs,
    roomCode: ticket?.roomCode ?? null,
    clientId: ticket?.memberId ?? "",
    zone:
      ticket?.zone ??
      (options.entry.kind === "code"
        ? options.fallbackZone
        : options.entry.zone),
    hostClientId,
    isHost:
      status === "ready" &&
      hostClientId !== null &&
      hostClientId === ticket?.memberId,
    crew:
      ticket?.members.map((member, seat) => ({
        clientId: member.clientId,
        name: member.name,
        seat,
        isHost: member.clientId === hostClientId,
        isYou: member.clientId === ticket.memberId,
      })) ?? [],
  };
}
