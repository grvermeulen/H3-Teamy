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
import { electPresentHost } from "@/lib/cityArena/net/election";
import { enterLobby, leaveLobby } from "@/lib/cityArena/net/lobbyPresence";
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
  TransportIdentity,
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
  /** This client's id — the user id — once connected; empty before. */
  clientId: string;
  /** Server time minus local time, from the connection; both loops keep time by it. */
  clockOffsetMs: number;
  /** The live transport, for the game to run its loop on; null until one is open. */
  transport: () => RealtimeTransport | null;
  zone: ZoneKey;
  crew: CrewMember[];
  /** The elected host, or null while nobody is present. */
  hostClientId: string | null;
  isHost: boolean;
  /** Set when a join was refused, so the lobby can say why in Dutch. */
  failure: JoinFailure | null;
  /**
   * Reports a host the game has stopped hearing from — or this client itself, when it hears
   * someone else hosting — so the room re-elects without them (spec §6.6).
   */
  reportHostLost: (clientId: string) => void;
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

/**
 * Leaves the room and the lobby without throwing, because the connection is closing either way.
 *
 * Failures still go to Sentry: a leave that did not land is how the launcher ends up showing a
 * ghost room that nobody can join.
 */
function leaveQuietly(transport: RealtimeTransport, code: string | null): void {
  if (!code) return;
  const report = (error: unknown): void => {
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "room-leave" },
    });
  };
  void leaveRoom(transport, code).catch(report);
  void leaveLobby(transport).catch(report);
}

/**
 * Turns a presence set into the crew, seated in join order.
 *
 * `presence.get()` promises no order, so the seat comes from the server-side presence timestamp
 * rather than the array index. It is a display position only: the *player id* a member drives is
 * an entity id the host hands out, carried on every snapshot as `seats`, and that — not this —
 * is what ties a scorebord row to an account.
 */
function crewFrom(
  members: PresenceMember[],
  myClientId: string,
  hostClientId: string | null,
): CrewMember[] {
  return [...members]
    .sort((first, second) => first.timestamp - second.timestamp)
    .map((member, seat) => ({
      clientId: member.clientId,
      seat,
      name: (member.data as PresenceData | undefined)?.name ?? "Speler",
      isHost: member.clientId === hostClientId,
      isYou: member.clientId === myClientId,
    }));
}

/** What the connection sequence reports back into React state as it progresses. */
type Report = {
  connected(identity: TransportIdentity): void;
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
  const identity = await transport.connect();
  if (!live()) return;
  report.connected(identity);

  const entered = await enterRoom(
    transport,
    entry,
    zone,
    presenceFor(identity.displayName),
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
  clockOffsetMs: number;
  transportRef: RefObject<RealtimeTransport | null>;
  codeRef: RefObject<string | null>;
};

/** What {@link useRoomConnection} keeps in React state. */
type ConnectionSetters = {
  setStatus: (status: ArenaRoom["status"]) => void;
  setConnection: (state: ConnectionState) => void;
  setRoomCode: (code: string | null) => void;
  setFailure: (reason: JoinFailure | null) => void;
  setMembers: (members: PresenceMember[]) => void;
  setIdentity: (identity: TransportIdentity) => void;
};

/** The report the connection sequence writes into React state. */
function reportInto(
  set: ConnectionSetters,
  codeRef: RefObject<string | null>,
): Report {
  return {
    connected(identity) {
      set.setIdentity(identity);
      set.setConnection("connected");
    },
    refused(reason) {
      set.setFailure(reason);
      set.setStatus("failed");
    },
    entered(code) {
      codeRef.current = code;
      set.setRoomCode(code);
    },
    members: set.setMembers,
    ready: () => set.setStatus("ready"),
  };
}

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
  const [identity, setIdentity] = useState<TransportIdentity | null>(null);
  const transportRef = useRef<RealtimeTransport | null>(null);
  const codeRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const transport = createTransport();
    transportRef.current = transport;
    const stopState = transport.onConnectionState(setConnection);
    const report = reportInto(
      {
        setStatus,
        setConnection,
        setRoomCode,
        setFailure,
        setMembers,
        setIdentity,
      },
      codeRef,
    );

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
    myClientId: identity?.clientId ?? "",
    name: identity?.displayName ?? "",
    clockOffsetMs: identity?.serverTimeOffsetMs ?? 0,
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
    // Enter rather than update: a host elected mid-match was never in the lobby, and entering
    // while already present is an update anyway.
    void enterLobby(transport, {
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
 * The hosts this client has given up on, for the election to skip.
 *
 * A member who leaves is forgotten, so someone who comes back after a bad connection starts with
 * a clean slate rather than being passed over for the rest of the evening.
 */
function useLostHosts(members: PresenceMember[]): {
  lost: ReadonlySet<string>;
  reportHostLost: (clientId: string) => void;
} {
  const [lost, setLost] = useState<ReadonlySet<string>>(new Set());
  const reportHostLost = useCallback((clientId: string) => {
    setLost((previous) =>
      previous.has(clientId) ? previous : new Set([...previous, clientId]),
    );
  }, []);
  useEffect(() => {
    setLost((previous) => {
      const present = [...previous].filter((id) =>
        members.some((member) => member.clientId === id),
      );
      return present.length === previous.size ? previous : new Set(present);
    });
  }, [members]);
  return { lost, reportHostLost };
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

  const { lost, reportHostLost } = useLostHosts(link.members);
  const hostClientId = useMemo(
    () => electPresentHost(link.members, lost),
    [link.members, lost],
  );
  const crew = useMemo(
    () => crewFrom(link.members, link.myClientId, hostClientId),
    [link.members, link.myClientId, hostClientId],
  );
  const isHost = hostClientId !== null && hostClientId === link.myClientId;
  useLobbyAdvertisement(link, isHost, zone);

  const transport = useCallback(
    () => link.transportRef.current,
    [link.transportRef],
  );

  const leave = useCallback(() => {
    const transport = link.transportRef.current;
    if (!transport) return;
    leaveQuietly(transport, link.codeRef.current);
    transport.close();
    // The unmount cleanup runs next; with the refs cleared it has nothing to close twice.
    link.transportRef.current = null;
    link.codeRef.current = null;
  }, [link.transportRef, link.codeRef]);

  return {
    status: link.status,
    connection: link.connection,
    roomCode: link.roomCode,
    clientId: link.myClientId,
    clockOffsetMs: link.clockOffsetMs,
    transport,
    zone,
    crew,
    hostClientId,
    isHost,
    failure: link.failure,
    reportHostLost,
    leave,
  };
}
