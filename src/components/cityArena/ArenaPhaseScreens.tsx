"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { rankScoreboard, type ScoreLine } from "@/lib/cityArena/net/scoreboard";
import { ArenaCountdown } from "./ArenaCountdown";
import { ArenaLobby, type CrewMember } from "./ArenaLobby";
import { ArenaScoreboard, LIVE_TITLE } from "./ArenaScoreboard";
import type { ArenaGame } from "./useArenaGame";
import type { ArenaRoom } from "./useArenaRoom";
import { useMatchClock } from "./useMatchClock";

/** Props for {@link ArenaPhaseScreens}. */
export type ArenaPhaseScreensProps = {
  game: ArenaGame;
  room: ArenaRoom & { leave: () => void };
  onClose: () => void;
  /** True while Tab is held: the scorebord as it stands, over the running match (spec §7). */
  showScoreboard?: boolean;
};

/** How often the live scorebord re-reads the simulation while it is up. */
const LIVE_SCOREBOARD_MS = 500;

/** The scorebord as it stands right now, re-read twice a second for as long as it is shown. */
function useLiveScoreboard(
  game: ArenaGame,
  active: boolean,
): { lines: ScoreLine[]; accounts: ReadonlyMap<number, string> } {
  const [, setBeat] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(
      () => setBeat((beat) => beat + 1),
      LIVE_SCOREBOARD_MS,
    );
    return () => clearInterval(timer);
  }, [active]);
  const peek = active ? game.peek() : null;
  if (!peek) return { lines: [], accounts: new Map() };
  return {
    lines: rankScoreboard(peek.tally, peek.players, peek.youId),
    accounts: new Map(
      [...peek.seats].map(([clientId, playerId]) => [playerId, clientId]),
    ),
  };
}

/** The dim veil every panel sits on, over the city that keeps running underneath. */
const VEIL_CLASS =
  "absolute inset-0 z-10 overflow-y-auto bg-[rgba(7,9,11,0.92)] pt-safe pb-safe-bottom-bar pl-safe pr-safe";

/**
 * Names for the scorebord, by player id.
 *
 * A row belongs to a player id the host handed out; the host's seats say which account that is,
 * and the crew says what that account is called. A player nobody can name is left out, and the
 * scorebord falls back to their number.
 */
function useScoreboardNames(
  crew: CrewMember[],
  accounts: ReadonlyMap<number, string>,
): ReadonlyMap<number, string> {
  return useMemo(() => {
    const nameByClient = new Map(
      crew.map((member) => [member.clientId, member.name]),
    );
    const names = new Map<number, string>();
    for (const [playerId, clientId] of accounts) {
      const name = nameByClient.get(clientId);
      if (name) names.set(playerId, name);
    }
    return names;
  }, [crew, accounts]);
}

/**
 * Whichever of the lobby, the countdown or the scorebord the match clock says is showing.
 *
 * These sit *over* the running city rather than beside it: spec §2 has members free-roaming the
 * whole map while they wait, so the canvas keeps drawing behind the panel instead of being
 * unmounted and reloaded when the potje starts. During the match itself this renders nothing.
 *
 * @param props - The running game, the room, and how to close the overlay.
 * @returns The panel for the current phase, or nothing while playing.
 */
export function ArenaPhaseScreens({
  game,
  room,
  onClose,
  showScoreboard = false,
}: ArenaPhaseScreensProps): React.JSX.Element | null {
  const { zone } = room;
  const recording = useMemo(
    () => ({
      roomCode: room.roomCode,
      zone,
      isHost: room.isHost,
      ticket: room.ticket,
      startRound: room.startRound,
      clockOffsetMs: room.clockOffsetMs,
    }),
    [
      room.roomCode,
      room.isHost,
      zone,
      room.ticket,
      room.startRound,
      room.clockOffsetMs,
    ],
  );
  const clock = useMatchClock(game, recording);
  const [exploring, setExploring] = useState(false);
  const exploreButton = useRef<HTMLButtonElement>(null);
  const lobbyButton = useRef<HTMLButtonElement>(null);
  const changedExploring = useRef(false);
  useEffect(() => {
    if (!changedExploring.current) return;
    (exploring ? lobbyButton : exploreButton).current?.focus();
  }, [exploring]);
  const toggleExploring = (): void => {
    changedExploring.current = true;
    setExploring((value) => !value);
  };
  const crewNames = useScoreboardNames(room.crew, clock.accounts);
  const inPlay = clock.phase === "countdown" || clock.phase === "playing";
  const live = useLiveScoreboard(game, showScoreboard && inPlay);
  const liveNames = useScoreboardNames(room.crew, live.accounts);
  const leave = (): void => {
    room.leave();
    onClose();
  };

  if (clock.phase === "lobby" && exploring)
    return (
      <div className="pointer-events-none absolute inset-x-2 top-[calc(4.5rem+env(safe-area-inset-top))] z-10 flex justify-start">
        <button
          type="button"
          className="pointer-events-auto min-h-11 max-w-[calc(100%-112px)] truncate rounded border border-[var(--arena-line)] bg-[var(--arena-panel)] px-4 text-sm text-[var(--arena-text)] shadow-lg"
          ref={lobbyButton}
          onClick={toggleExploring}
        >
          {room.roomCode ?? "Verbinden…"} · {room.crew.length}/8 · Lobby openen
        </button>
      </div>
    );
  if (clock.phase === "lobby")
    return (
      <div className={VEIL_CLASS}>
        <div className="flex justify-end px-4 pt-3">
          <button
            type="button"
            className="min-h-11 rounded border border-[var(--arena-line)] px-4 text-sm"
            ref={exploreButton}
            onClick={toggleExploring}
          >
            Stad verkennen ↓
          </button>
        </div>
        {room.failure || clock.error ? (
          <p role="alert" className="m-3 text-sm text-[var(--arena-alert)]">
            {room.failure || clock.error}
          </p>
        ) : null}
        <ArenaLobby
          roomCode={room.roomCode ?? "……"}
          zone={zone}
          crew={room.crew}
          connection={room.connection}
          isHost={room.isHost}
          onStart={clock.start}
          onEnterCode={onClose}
          onLeave={leave}
        />
      </div>
    );
  // Before the countdown: Tab during the count still shows the board, as `inPlay` promises.
  if (showScoreboard && inPlay)
    return (
      <div className={VEIL_CLASS}>
        <ArenaScoreboard
          title={LIVE_TITLE}
          lines={live.lines}
          names={liveNames}
          secondsLeft={clock.secondsLeft ?? 0}
          onLeave={leave}
        />
      </div>
    );
  if (clock.phase === "countdown" && clock.countdown !== null)
    return <ArenaCountdown count={clock.countdown} zone={zone} />;
  if (clock.phase === "scoreboard")
    return (
      <div className={VEIL_CLASS}>
        <ArenaScoreboard
          lines={clock.scoreboard}
          names={crewNames}
          secondsLeft={clock.secondsLeft ?? 0}
          onRematch={
            room.isHost && !clock.saving && !clock.error
              ? clock.backToLobby
              : undefined
          }
          onLeave={leave}
          saving={clock.saving}
          error={clock.error}
          onRetry={clock.retryResult}
        />
      </div>
    );
  return null;
}
