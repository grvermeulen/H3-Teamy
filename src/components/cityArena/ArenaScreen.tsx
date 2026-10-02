"use client";

import { useRef, useState } from "react";
import type { ArenaEntry } from "./arenaEntry";
import { useArenaRoom } from "./useArenaRoom";
import { useArenaScreenGame } from "./useArenaScreenGame";
import { useArenaWakeLock } from "./useArenaWakeLock";
import { ArenaPhaseScreens } from "./ArenaPhaseScreens";
import { ConnectionBanner } from "./ConnectionBanner";
import { ATTRIBUTION_TEXT } from "./ArenaLoadingScreen";

/** A full-screen shared view, usable in a TV browser without signing into H3. */
export function ArenaScreen({
  entry,
  onClose,
}: {
  entry: ArenaEntry;
  onClose: () => void;
}): React.JSX.Element {
  const [canHost, setCanHost] = useState(false);
  const room = useArenaRoom({ entry, fallbackZone: "rhenen", canHost });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useArenaScreenGame(room, canvasRef, setCanHost);
  useArenaWakeLock();
  return (
    <div className="arena fixed inset-0 z-[3200] flex h-dvh flex-col bg-[var(--arena-void)] text-[var(--arena-text)] pt-safe pb-[env(safe-area-inset-bottom)] pl-safe pr-safe">
      <ConnectionBanner state={room.connection} />
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--arena-line)] px-5 py-3">
        <h1 className="arena-display text-2xl">
          GTA H3 · Scherm{" "}
          <span className="text-[var(--arena-amber)]">{room.roomCode}</span>
        </h1>
        <button className="min-h-11 px-3" onClick={onClose}>
          Scherm sluiten
        </button>
      </header>
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          aria-label="GTA H3 gezamenlijk speelveld"
          className="block h-full w-full"
        />
        {game.loading ? (
          <p role="status" className="absolute inset-x-4 top-1/2 text-center">
            Spelbeeld laden…
          </p>
        ) : null}
        {!room.hostClientId && !game.loading ? (
          <p role="status" className="absolute inset-x-4 top-1/2 text-center">
            Wachten op een beschikbaar scherm…
          </p>
        ) : null}
        {game.failure ? (
          <p
            role="alert"
            className="absolute inset-x-4 bottom-3 text-center text-[var(--arena-amber)]"
          >
            {game.failure}
          </p>
        ) : null}
      </div>
      <p className="p-2 text-center text-xs text-[var(--arena-dim)]">
        {ATTRIBUTION_TEXT}
      </p>
      <ArenaPhaseScreens room={room} game={game} onClose={onClose} />
    </div>
  );
}
