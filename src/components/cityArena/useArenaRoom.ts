"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { createAblyTransport } from "@/lib/cityArena/net/ablyTransport";
import { electHost } from "@/lib/cityArena/net/election";
import {
  enterLobby,
  leaveLobby,
  updateLobby,
} from "@/lib/cityArena/net/lobbyPresence";
import {
  createRoomCode,
  joinRoom,
  leaveRoom,
  openRoom,
  roomChannelName,
  type JoinFailure,
} from "@/lib/cityArena/net/room";
import type {
  ConnectionState,
  PresenceData,
  PresenceMember,
  RealtimeTransport,
} from "@/lib/cityArena/net/transport";
import type { ZoneKey } from "@/lib/cityArena/world/mapTypes";
import type { CrewMember } from "./ArenaLobby";
import type { ArenaEntry } from "./arenaEntry";

/** The colour a member is announced with; the lobby assigns display accents by seat. */
const DEFAULT_COLOUR = "#f5a524";

/** What the overlay knows about the room it is in. */
export type ArenaRoom = {
  status: "connecting" | "ready" | "failed";
  connection: ConnectionState;
  roomCode: string | null;
  zone: ZoneKey;
  crew: CrewMember[];
  isHost: boolean;
  /** Set when a join was refused, so the lobby can say why in Dutch. */
  failure: JoinFailure | null;
};

/** How {@link useArenaRoom} is configured. */
export type UseArenaRoomOptions = {
  entry: ArenaEntry;
  /** This player's display name, shown to the rest of the crew. */
  playerName: string;
  /** The zone to fall back to when the entry does not name one. */
  fallbackZone: ZoneKey;
  /** Injectable so tests can drive an in-memory transport. */
  createTransport?: () => RealtimeTransport;
};

/** Turns a presence set into the crew the lobby draws, with the host first. */
function crewFrom(
  members: PresenceMember[],
  myClientId: string,
  hostClientId: string | null,
): CrewMember[] {
  return members
    .map((member) => ({
      clientId: member.clientId,
      name: (member.data as PresenceData | undefined)?.name ?? "Speler",
      isHost: member.clientId === hostClientId,
      isYou: member.clientId === myClientId,
    }))
    .sort((first, second) => Number(second.isHost) - Number(first.isHost));
}

/**
 * Connects to a room and keeps its crew, host and connection state current.
 *
 * Joining and hosting differ only in how the room is entered: a host opens a fresh code and
 * advertises it in the lobby, a joiner enters an existing one. Everything after that — presence,
 * election, the crew list — is the same code, which is what keeps the two paths from drifting.
 *
 * @param options - The entry, this player's name, and the fallback zone.
 * @returns The room state, plus the actions the lobby offers.
 */
export function useArenaRoom(options: UseArenaRoomOptions): ArenaRoom & {
  leave: () => void;
} {
  const { entry, playerName, fallbackZone } = options;
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [roomCode, setRoomCode] = useState<string | null>(
    entry.kind === "join" ? entry.roomCode : null,
  );
  const [status, setStatus] = useState<ArenaRoom["status"]>("connecting");
  const [failure, setFailure] = useState<JoinFailure | null>(null);
  const [myClientId, setMyClientId] = useState<string>("");
  const transportRef = useRef<RealtimeTransport | null>(null);
  const codeRef = useRef<string | null>(null);

  const zone: ZoneKey =
    entry.kind === "code" ? fallbackZone : (entry.zone ?? fallbackZone);

  useEffect(() => {
    let cancelled = false;
    const transport = (options.createTransport ?? createAblyTransport)();
    transportRef.current = transport;
    const stopState = transport.onConnectionState(setConnection);

    const run = async (): Promise<void> => {
      try {
        const { clientId } = await transport.connect();
        if (cancelled) return;
        setMyClientId(clientId);
        setConnection("connected");

        const presence: PresenceData = {
          name: playerName,
          colour: DEFAULT_COLOUR,
          role: "player",
          device: "desktop",
        };

        // A joiner enters an existing code; a host opens a new one and advertises it.
        let code: string;
        if (entry.kind === "join") {
          code = entry.roomCode;
          const result = await joinRoom(transport, code, presence);
          if (cancelled) return;
          if (!result.ok) {
            setFailure(result.reason);
            setStatus("failed");
            return;
          }
        } else {
          code = createRoomCode(Math.random);
          await openRoom(transport, code, presence);
          if (cancelled) return;
          await enterLobby(transport, {
            host: presence,
            room: { roomCode: code, zone, players: 1, phase: "lobby" },
          });
        }
        if (cancelled) return;
        codeRef.current = code;
        setRoomCode(code);

        const channel = transport.channel(roomChannelName(code));
        const refresh = async (): Promise<void> => {
          const present = await channel.presence.get();
          if (!cancelled) setMembers(present);
        };
        channel.presence.subscribe(() => {
          void refresh();
        });
        await refresh();
        if (!cancelled) setStatus("ready");
      } catch (error: unknown) {
        Sentry.captureException(error, {
          tags: { area: "arena", kind: "room-connect" },
        });
        if (!cancelled) {
          setStatus("failed");
          setConnection("failed");
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      stopState();
      const code = codeRef.current;
      if (code) {
        void leaveRoom(transport, code).catch(() => undefined);
        void leaveLobby(transport).catch(() => undefined);
      }
      transport.close();
      transportRef.current = null;
    };
    // The entry identifies the room for the life of the overlay; re-running would rejoin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hostClientId = useMemo(() => electHost(members), [members]);
  const crew = useMemo(
    () => crewFrom(members, myClientId, hostClientId),
    [members, myClientId, hostClientId],
  );
  const isHost = hostClientId !== null && hostClientId === myClientId;

  // The lobby list shows a live player count, so refresh the advertisement as the crew changes.
  useEffect(() => {
    const transport = transportRef.current;
    const code = codeRef.current;
    if (!transport || !code || !isHost || members.length === 0) return;
    void updateLobby(transport, {
      host: {
        name: playerName,
        colour: DEFAULT_COLOUR,
        role: "player",
        device: "desktop",
      },
      room: {
        roomCode: code,
        zone,
        players: members.length,
        phase: "lobby",
      },
    }).catch((error: unknown) => {
      Sentry.captureException(error, {
        tags: { area: "arena", kind: "lobby-update" },
      });
    });
  }, [isHost, members.length, playerName, zone]);

  const leave = useCallback(() => {
    const transport = transportRef.current;
    const code = codeRef.current;
    if (!transport) return;
    if (code) {
      void leaveRoom(transport, code).catch(() => undefined);
      void leaveLobby(transport).catch(() => undefined);
    }
    transport.close();
  }, []);

  return {
    status,
    connection,
    roomCode,
    zone,
    crew,
    isHost,
    failure,
    leave,
  };
}
