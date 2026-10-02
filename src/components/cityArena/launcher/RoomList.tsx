"use client";

import type { LobbyRoom } from "@/lib/cityArena/net/lobbyPresence";
import { MissionCard } from "./MissionCard";

/** What the launcher knows about the active potjes right now. */
export type RoomsState =
  | { status: "loading" }
  | { status: "ready"; rooms: LobbyRoom[] }
  | { status: "offline" };

/** Props for {@link RoomList}. */
export type RoomListProps = {
  state: RoomsState;
  onJoin: (room: LobbyRoom) => void;
};

/** The skeleton shown while the first fetch is in flight. */
function LoadingRooms(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="arena-card p-3"
    >
      <span className="arena-label text-[var(--arena-dim)]">Potjes laden…</span>
      <div className="mt-2 h-2 w-2/3 bg-[var(--arena-line)]" />
      <div className="mt-1.5 h-2 w-1/3 bg-[var(--arena-line)]" />
    </div>
  );
}

/**
 * Shown both when nobody is hosting and when the lobby could not be read.
 *
 * They deliberately look the same. From a player's point of view "there is nothing to join" is
 * the same fact either way, and an error box on the home page for a game nobody is playing would
 * be noise — the failure is already in Sentry.
 */
function NoRooms(): React.JSX.Element {
  return (
    <div className="arena-card p-3">
      <span className="arena-label text-[var(--arena-dim)]">
        Geen actieve potjes
      </span>
      <p className="mt-1.5 text-[13px] text-[var(--arena-dim)]">
        Start er zelf een — de stad is altijd open.
      </p>
    </div>
  );
}

/**
 * The "Actieve potjes" list.
 *
 * @param props - The current rooms state and the join handler.
 * @returns The list, or the loading or empty state.
 */
export function RoomList({ state, onJoin }: RoomListProps): React.JSX.Element {
  if (state.status === "loading") return <LoadingRooms />;
  if (state.status === "offline" || state.rooms.length === 0)
    return <NoRooms />;
  return (
    <ul className="flex flex-col gap-1.5">
      {state.rooms.map((room, index) => (
        <li key={room.roomCode}>
          <MissionCard
            room={room}
            index={index}
            featured={index === 0}
            onJoin={onJoin}
          />
        </li>
      ))}
    </ul>
  );
}
