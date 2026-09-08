"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { loadArenaSettings, saveArenaSettings } from "@/lib/cityArena/storage";
import type { LobbyRoom } from "@/lib/cityArena/net/lobbyPresence";
import type { ZoneKey } from "@/lib/cityArena/world/mapTypes";
import { useSession } from "../SessionContext";
import { ATTRIBUTION_TEXT } from "./ArenaLoadingScreen";
import { CityArenaLaunchIcon } from "./CityArenaLaunchIcon";
import { ArenaLeaderboard } from "./launcher/ArenaLeaderboard";
import { RoomList } from "./launcher/RoomList";
import { useActiveRooms } from "./launcher/useActiveRooms";
import type { ArenaEntry } from "./arenaEntry";

/** Same full-screen layer as the overlay itself, so the chunk load never flashes inline. */
function ChunkLoadingOverlay(): React.JSX.Element | null {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="arena fixed inset-0 z-[3200] flex items-center justify-center touch-none bg-[var(--arena-void)] pt-safe pb-safe-bottom-bar pl-safe pr-safe"
    >
      <p className="arena-label text-[var(--arena-dim)]">Spel laden…</p>
    </div>,
    document.body,
  );
}

const CityArenaOverlay = dynamic(
  () => import("./CityArenaOverlay").then((module) => module.default),
  { ssr: false, loading: () => <ChunkLoadingOverlay /> },
);

/** Props for {@link LauncherHeader}. */
type LauncherHeaderProps = { statusLine: string };

/** Title, pitch and the live status strip. */
function LauncherHeader({
  statusLine,
}: LauncherHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <CityArenaLaunchIcon size={44} decorative className="shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="arena-label block text-[var(--arena-online)]">
          <span className="arena-pulse mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--arena-online)] align-middle" />
          {statusLine}
        </span>
        <h2 className="arena-display mt-1 text-2xl leading-none text-[var(--arena-text)]">
          GTA H3
        </h2>
        <p className="mt-1.5 text-[13px] text-[var(--arena-dim)]">
          Verken de stad samen en start een potje.
        </p>
      </div>
    </div>
  );
}

/** Props for {@link LauncherActions}. */
type LauncherActionsProps = {
  onNewRoom: () => void;
  onEnterCode: () => void;
  onLeaderboard: () => void;
};

/** Nieuw potje / Code invoeren / Ranglijst. */
function LauncherActions({
  onNewRoom,
  onEnterCode,
  onLeaderboard,
}: LauncherActionsProps): React.JSX.Element {
  return (
    <div className="mt-3 flex flex-wrap items-stretch gap-1.5">
      <button
        type="button"
        onClick={onNewRoom}
        className="arena-label flex-1 basis-[46%] border border-[var(--arena-line-strong)] bg-[var(--arena-panel-raised)] px-3 py-3 text-[var(--arena-text)] transition hover:border-[var(--arena-amber)] hover:text-[var(--arena-amber)] active:scale-[0.99]"
      >
        Nieuw potje
      </button>
      <button
        type="button"
        onClick={onEnterCode}
        className="arena-label flex-1 basis-[46%] border border-[var(--arena-line-strong)] bg-[var(--arena-panel-raised)] px-3 py-3 text-[var(--arena-text)] transition hover:border-[var(--arena-amber)] hover:text-[var(--arena-amber)] active:scale-[0.99]"
      >
        Code invoeren
      </button>
      <button
        type="button"
        onClick={onLeaderboard}
        className="arena-label flex items-center justify-center border border-transparent px-2 py-3 text-[var(--arena-dim)] transition hover:text-[var(--arena-amber)]"
      >
        Ranglijst →
      </button>
    </div>
  );
}

/** Login prompt shown to visitors who are not signed in. */
function LoginHint(): React.JSX.Element {
  return (
    <Link
      href={{ pathname: "/login", query: { callbackUrl: "/" } }}
      className="arena-label mt-3 flex items-center justify-center border border-[var(--arena-line-strong)] bg-[var(--arena-panel-raised)] px-3 py-3 text-[var(--arena-text)]"
    >
      Log in om mee te doen
    </Link>
  );
}

/** The live strip: how many potjes are running right now. */
function statusLineFor(count: number | null): string {
  if (count === null) return "Teamy online · potjes laden";
  if (count === 0) return "Teamy online · geen potjes";
  return `Teamy online · ${String(count).padStart(2, "0")} potjes actief`;
}

/** Card under Space Invaders: the active potjes, and the ways into one. */
export default function CityArenaLauncher(): React.JSX.Element {
  const session = useSession();
  const loggedIn = !session.loading && session.loggedIn;
  const rooms = useActiveRooms(loggedIn);
  const [entry, setEntry] = useState<ArenaEntry | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [zone] = useState<ZoneKey>(() => loadArenaSettings().lastZone);

  const statusLine = useMemo(
    () => statusLineFor(rooms.status === "ready" ? rooms.rooms.length : null),
    [rooms],
  );

  const openNewRoom = useCallback(() => {
    saveArenaSettings({ lastZone: zone });
    setEntry({ kind: "new", zone });
  }, [zone]);
  const openCodeEntry = useCallback(() => setEntry({ kind: "code" }), []);
  const openRoom = useCallback((room: LobbyRoom) => {
    setEntry({ kind: "join", roomCode: room.roomCode, zone: room.zone });
  }, []);
  const close = useCallback(() => setEntry(null), []);

  return (
    <>
      <div className="arena card mt-4 border-[var(--arena-line)] bg-[var(--arena-asphalt)] p-3">
        <LauncherHeader statusLine={statusLine} />
        <div className="mt-3">
          {loggedIn ? (
            <RoomList state={rooms} onJoin={openRoom} />
          ) : (
            <LoginHint />
          )}
        </div>
        {loggedIn && showLeaderboard ? <ArenaLeaderboard /> : null}
        {loggedIn ? (
          <LauncherActions
            onNewRoom={openNewRoom}
            onEnterCode={openCodeEntry}
            onLeaderboard={() => setShowLeaderboard((open) => !open)}
          />
        ) : null}
        <p className="mt-3 text-[10px] text-[var(--arena-dim)]">
          {ATTRIBUTION_TEXT}
        </p>
      </div>
      {entry && loggedIn ? (
        <CityArenaOverlay entry={entry} onClose={close} />
      ) : null}
    </>
  );
}
