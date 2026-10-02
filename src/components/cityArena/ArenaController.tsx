"use client";

import { useMemo, useState } from "react";
import { createStick } from "@/lib/cityArena/input/touchStick";
import type { ArenaEntry } from "./arenaEntry";
import { useArenaRoom } from "./useArenaRoom";
import { useArenaController } from "./useArenaController";
import { useArenaWakeLock } from "./useArenaWakeLock";
import TouchStick from "./TouchStick";
import ArenaTouchButtons from "./ArenaTouchButtons";
import ArenaVitals from "./ArenaVitals";
import { ConnectionBanner } from "./ConnectionBanner";
import { ArenaPhaseScreens } from "./ArenaPhaseScreens";
import { ArenaMissionPanel } from "./ArenaMissionPanel";

/** Phone-only controls and status, without a canvas, world boot or image preloads. */
export function ArenaController({
  entry,
  onClose,
}: {
  entry: ArenaEntry;
  onClose: () => void;
}): React.JSX.Element {
  const room = useArenaRoom({ entry, fallbackZone: "rhenen" });
  const [vibrate, setVibrate] = useState(true);
  const game = useArenaController(room, vibrate);
  const awake = useArenaWakeLock();
  const stick = useMemo(() => createStick(), []);
  const aim = useMemo(() => createStick(), []);
  const me = game.player;
  return (
    <div className="arena fixed inset-0 z-[3200] flex h-dvh touch-none select-none flex-col bg-[var(--arena-void)] text-[var(--arena-text)] pt-safe pb-[env(safe-area-inset-bottom)] pl-safe pr-safe">
      <ConnectionBanner state={room.connection} />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--arena-line)] p-3">
        <div>
          <h1 className="arena-display text-xl">
            Controller · {room.roomCode ?? "Verbinden…"}
          </h1>
          {me ? (
            <ArenaVitals
              health={me.health}
              weapon={me.weapon}
              ammo={me.ammo}
              speedMps={null}
              drunk={me.drunk}
            />
          ) : null}
        </div>
        <button className="min-h-11 px-3" onClick={onClose}>
          Verlaten
        </button>
      </header>
      <main className="relative min-h-0 flex-1">
        {game.mission && (
          <ArenaMissionPanel
            mission={{ ...game.mission, destination: null }}
            onAction={game.missionAction}
            onRoute={() => undefined}
          />
        )}
        <div className="pointer-events-none absolute inset-x-3 top-4 text-center">
          <p className="arena-display text-2xl">
            {me?.health === 0
              ? "Je komt zo terug"
              : game.receiving
                ? "Kijk naar het grote scherm"
                : "Wachten op het scherm…"}
          </p>
          <p className="mt-2 text-sm text-[var(--arena-dim)]">
            Links lopen of sturen · rechts richten en schieten
          </p>
        </div>
        <TouchStick stick={stick} onVector={game.setInputVector} />
        <TouchStick side="right" stick={aim} onVector={game.setAimVector} />
        <ArenaTouchButtons
          interactionLabel={game.mission?.action ?? undefined}
          inVehicle={me?.vehicleId != null}
          onButton={game.setButton}
          showFire={false}
        />
      </main>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 p-2 text-xs text-[var(--arena-dim)]">
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={vibrate}
            onChange={(event) => setVibrate(event.target.checked)}
          />
          Trillen
        </label>
        <span>
          {awake ? "Scherm blijft wakker" : "Houd je telefoon actief"}
        </span>
        <span>Gamepad: sticks · RT/A schieten · B instappen · Y/RB wapen</span>
      </footer>
      <ArenaPhaseScreens room={room} game={game} onClose={onClose} />
    </div>
  );
}
