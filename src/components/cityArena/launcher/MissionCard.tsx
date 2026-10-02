"use client";

import type { LobbyRoom } from "@/lib/cityArena/net/lobbyPresence";
import { ROOM_CAPACITY } from "@/lib/cityArena/net/room";
import { ZONE_OPTIONS } from "@/lib/cityArena/constants";

/** Two digits, so the list reads as a manifest rather than a bulleted list. */
function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** The Dutch name of a zone, falling back to the key if the map ever gains one we do not know. */
export function zoneName(zone: string): string {
  return ZONE_OPTIONS.find((option) => option.key === zone)?.name ?? zone;
}

/**
 * The map-grid label for a zone: its key in caps.
 *
 * Deliberately not the display name, which is already the heading beside it — repeating that
 * inside the radar wastes the one place the panel has to say something else.
 */
export function zoneSector(zone: string): string {
  return zone.toUpperCase();
}

/** Props for {@link MissionCard}. */
export type MissionCardProps = {
  room: LobbyRoom;
  index: number;
  /** Highlighted, with the join button; the rest of the list is compact. */
  featured: boolean;
  onJoin: (room: LobbyRoom) => void;
};

/** The radar square: a zone marker on a map grid, drawn in CSS rather than loaded. */
function ZonePreview({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="arena-grid relative hidden h-[104px] w-[190px] shrink-0 border border-[var(--arena-line)] bg-[var(--arena-void)] sm:block">
      <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--arena-amber)] shadow-[0_0_14px_3px_rgba(245,165,36,0.55)]" />
      <span className="arena-label absolute bottom-1.5 left-2 text-[9px] text-[var(--arena-online)]">
        {label}
      </span>
      <span className="arena-label absolute right-2 top-2 text-[9px] text-[var(--arena-dim)]">
        Sector
      </span>
    </div>
  );
}

/** A room that is running but not the featured one: one compact line. */
function CompactRoom({
  room,
  onJoin,
}: {
  room: LobbyRoom;
  onJoin: (room: LobbyRoom) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onJoin(room)}
      className="arena-card flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:border-l-[var(--arena-amber)] hover:bg-[var(--arena-panel-raised)]"
    >
      <span className="arena-display truncate text-sm text-[var(--arena-text)]">
        {zoneName(room.zone)}
      </span>
      <span className="shrink-0 text-[11px] text-[var(--arena-dim)]">
        {room.players} spelers ·{" "}
        {room.phase === "playing" ? "bezig" : "in lobby"}
      </span>
    </button>
  );
}

/**
 * One active potje.
 *
 * The featured card carries the join action; the rest of the list is a compact row, so a busy
 * lobby does not push the launcher's own buttons off a phone screen.
 *
 * @param props - The room, its position, whether it is featured, and the join handler.
 * @returns The mission card.
 */
export function MissionCard({
  room,
  index,
  featured,
  onJoin,
}: MissionCardProps): React.JSX.Element {
  if (!featured) return <CompactRoom room={room} onJoin={onJoin} />;

  const full = room.players >= ROOM_CAPACITY;
  return (
    <div className="arena-card arena-card-active flex gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="arena-label text-[var(--arena-amber)]">
            Actief potje · {ordinal(index)}
          </span>
          <span className="arena-label border border-[var(--arena-line-strong)] px-1.5 py-0.5 text-[9px] text-[var(--arena-dim)]">
            {room.phase === "playing" ? "Bezig" : "In lobby"}
          </span>
        </div>
        <h3 className="arena-display mt-1.5 truncate text-xl text-[var(--arena-text)]">
          {zoneName(room.zone)}
        </h3>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--arena-dim)]">
          <span className="truncate uppercase tracking-wider">
            {room.hostName} is host
          </span>
          <span className="shrink-0 tabular-nums">
            {room.players} / {ROOM_CAPACITY} crew
          </span>
        </div>
        <button
          type="button"
          onClick={() => onJoin(room)}
          disabled={full}
          className="arena-label mt-3 w-full bg-[var(--arena-amber)] px-3 py-3 text-[var(--arena-void)] transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-[var(--arena-line-strong)] disabled:text-[var(--arena-dim)]"
        >
          {full ? "Potje is vol" : "Meedoen · lobby openen"}
        </button>
      </div>
      <ZonePreview label={zoneSector(room.zone)} />
    </div>
  );
}
