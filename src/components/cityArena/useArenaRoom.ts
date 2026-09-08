"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
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
  /** The zone to fall back to when the entry does not name one. */
  fallbackZone: ZoneKey;
  /** Injectable so tests can drive an in-memory transport. */
  createTransport?: () => RealtimeTransport;
};

/** Announces this player to a room as a plain desktop player. */
function presenceFor(displayName: string): PresenceData {
  return {
    name: displayName,
    colour: DEFAULT_COLOUR,
    role: "player",
    device: "desktop",
  };
}

/** Where the connection ended up: in a room, or refused. */
type Entered = { ok: true; code: string } | { ok: false; reason: JoinFailure };

/**
 * Enters the room the entry names: a joiner into an existing code, a host into a fresh one that
 * it then advertises in the lobby. Everything after this — presence, election, the crew — is the
 * same code for both, which is what keeps the two paths from drifting.
 */
async function enterRoom(
  transport: RealtimeTransport,
  entry: ArenaEntry,
  zone: ZoneKey,
  presence: PresenceData,
): Promise<Entered> {
  if (entry.kind === "join") {
    const result = await joinRoom(transport, entry.roomCode, presence);
    return result.ok
      ? { ok: true, code: entry.roomCode }
      : { ok: false, reason: result.reason };
  }
  const code = createRoomCode(Math.random);
  await openRoom(transport, code, presence);
  await enterLobby(transport, {
    host: presence,
    room: { roomCode: code, zone, players: 1, phase: "lobby" },
  });
  return { ok: true, code };
}

/** Leaves the room and the lobby, ignoring failures: the connection is closing anyway. */
function leaveQuietly(transport: RealtimeTransport, code: string | null): void {
  if (!code) return;
  void leaveRoom(transport, code).catch(() => undefined);
  void leaveLobby(transport).catch(() => undefined);
}

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

/** What the connection sequence reports back into React state as it progresses. */
type Report = {
  connected(clientId: string, name: string): void;
  refused(reason: JoinFailure): void;
  entered(code: string): void;
  members(present: PresenceMember[]): void;
  ready(): void;
};

/**
 * Connects, enters the room and starts watching its presence set.
 *
 * `live()` answers whether anyone is still listening: the overlay may have closed while an
 * await was in flight, and reporting into an unmounted hook is how React warnings — and stale
 * presence entries — get made.
 */
async function establish(
  transport: RealtimeTransport,
  entry: ArenaEntry,
  zone: ZoneKey,
  report: Report,
  live: () => boolean,
): Promise<void> {
  // The name comes from the token response the transport already fetched — the player's first
  // name in the H3 app — so nothing here has to guess or ask again.
  const { clientId, displayName } = await transport.connect();
  if (!live()) return;
  report.connected(clientId, displayName);

  const entered = await enterRoom(
    transport,
    entry,
    zone,
    presenceFor(displayName),
  );
  if (!live()) return;
  if (!entered.ok) return report.refused(entered.reason);
  report.entered(entered.code);

  const channel = transport.channel(roomChannelName(entered.code));
  const refresh = async (): Promise<void> => {
    const present = await channel.presence.get();
    if (live()) report.members(present);
  };
  channel.presence.subscribe(() => {
    void refresh();
  });
  await refresh();
  if (live()) report.ready();
}

/** Everything the connection effect produces. */
type Connection = {
  status: ArenaRoom["status"];
  connection: ConnectionState;
  roomCode: string | null;
  failure: JoinFailure | null;
  members: PresenceMember[];
  myClientId: string;
  name: string;
  transportRef: RefObject<RealtimeTransport | null>;
  codeRef: RefObject<string | null>;
};

/**
 * Opens the transport, enters the room and keeps its presence set current for as long as the
 * overlay is mounted.
 *
 * The entry identifies the room for the life of the overlay, so the effect deliberately runs
 * once: re-running it would leave and rejoin the room.
 */
function useRoomConnection(
  entry: ArenaEntry,
  zone: ZoneKey,
  createTransport: () => RealtimeTransport,
): Connection {
  const [status, setStatus] = useState<ArenaRoom["status"]>("connecting");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [roomCode, setRoomCode] = useState<string | null>(
    entry.kind === "join" ? entry.roomCode : null,
  );
  const [failure, setFailure] = useState<JoinFailure | null>(null);
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [myClientId, setMyClientId] = useState("");
  const [name, setName] = useState("");
  const transportRef = useRef<RealtimeTransport | null>(null);
  const codeRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const transport = createTransport();
    transportRef.current = transport;
    const stopState = transport.onConnectionState(setConnection);
    const report: Report = {
      connected(clientId, name) {
        setMyClientId(clientId);
        setName(name);
        setConnection("connected");
      },
      refused(reason) {
        setFailure(reason);
        setStatus("failed");
      },
      entered(code) {
        codeRef.current = code;
        setRoomCode(code);
      },
      members: setMembers,
      ready: () => setStatus("ready"),
    };

    establish(transport, entry, zone, report, () => !cancelled).catch(
      (error: unknown) => {
        Sentry.captureException(error, {
          tags: { area: "arena", kind: "room-connect" },
        });
        if (!cancelled) {
          setStatus("failed");
          setConnection("failed");
        }
      },
    );
    return () => {
      cancelled = true;
      stopState();
      leaveQuietly(transport, codeRef.current);
      transport.close();
      transportRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    connection,
    roomCode,
    failure,
    members,
    myClientId,
    name,
    transportRef,
    codeRef,
  };
}

/**
 * Keeps this host's lobby advertisement current as the crew changes.
 *
 * The launcher shows a live player count, and presence alone does not carry it: the host has to
 * republish its summary whenever someone joins or leaves.
 */
function useLobbyAdvertisement(
  link: Connection,
  isHost: boolean,
  zone: ZoneKey,
): void {
  const { transportRef, codeRef, members, name } = link;
  useEffect(() => {
    const transport = transportRef.current;
    const code = codeRef.current;
    if (!transport || !code || !isHost || members.length === 0) return;
    void updateLobby(transport, {
      host: presenceFor(name),
      room: { roomCode: code, zone, players: members.length, phase: "lobby" },
    }).catch((error: unknown) => {
      Sentry.captureException(error, {
        tags: { area: "arena", kind: "lobby-update" },
      });
    });
  }, [transportRef, codeRef, isHost, members.length, name, zone]);
}

/**
 * Connects to a room and keeps its crew, host and connection state current.
 *
 * @param options - The entry and the fallback zone.
 * @returns The room state, plus the actions the lobby offers.
 */
export function useArenaRoom(options: UseArenaRoomOptions): ArenaRoom & {
  leave: () => void;
} {
  const { entry, fallbackZone } = options;
  const zone: ZoneKey =
    entry.kind === "code" ? fallbackZone : (entry.zone ?? fallbackZone);
  const link = useRoomConnection(
    entry,
    zone,
    options.createTransport ?? createAblyTransport,
  );

  const hostClientId = useMemo(() => electHost(link.members), [link.members]);
  const crew = useMemo(
    () => crewFrom(link.members, link.myClientId, hostClientId),
    [link.members, link.myClientId, hostClientId],
  );
  const isHost = hostClientId !== null && hostClientId === link.myClientId;
  useLobbyAdvertisement(link, isHost, zone);

  const leave = useCallback(() => {
    const transport = link.transportRef.current;
    if (!transport) return;
    leaveQuietly(transport, link.codeRef.current);
    transport.close();
  }, [link.transportRef, link.codeRef]);

  return {
    status: link.status,
    connection: link.connection,
    roomCode: link.roomCode,
    zone,
    crew,
    isHost,
    failure: link.failure,
    leave,
  };
}
