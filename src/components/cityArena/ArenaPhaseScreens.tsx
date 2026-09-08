"use client";

import { useMemo } from "react";
import { ArenaCountdown } from "./ArenaCountdown";
import { ArenaLobby } from "./ArenaLobby";
import { ArenaScoreboard } from "./ArenaScoreboard";
import type { ArenaGame } from "./useArenaGame";
import type { ArenaRoom } from "./useArenaRoom";
import { useMatchClock } from "./useMatchClock";

/** Props for {@link ArenaPhaseScreens}. */
export type ArenaPhaseScreensProps = {
  game: ArenaGame;
  room: ArenaRoom & { leave: () => void };
  onClose: () => void;
};

/** The dim veil every panel sits on, over the city that keeps running underneath. */
const VEIL_CLASS =
  "absolute inset-0 z-10 overflow-y-auto bg-[rgba(7,9,11,0.92)] pt-safe pb-safe-bottom-bar pl-safe pr-safe";

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
}: ArenaPhaseScreensProps): React.JSX.Element | null {
  const { zone } = room;
  // Keyed by the seat each member holds — join order, fixed by the presence timestamp — not by
  // where they happen to sit in the array, which presence does not promise to keep stable.
  const crewNames = useMemo(
    () => new Map(room.crew.map((member) => [member.seat, member.name])),
    [room.crew],
  );
  const recording = useMemo(
    () => ({
      roomCode: room.roomCode,
      zone,
      isHost: room.isHost,
      userIdByPlayer: new Map(
        room.crew.map((member) => [member.seat, member.clientId]),
      ),
    }),
    [room.roomCode, room.isHost, room.crew, zone],
  );
  const clock = useMatchClock(game, recording);
  const leave = (): void => {
    room.leave();
    onClose();
  };

  if (clock.phase === "lobby")
    return (
      <div className={VEIL_CLASS}>
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
  if (clock.phase === "countdown" && clock.countdown !== null)
    return <ArenaCountdown count={clock.countdown} zone={zone} />;
  if (clock.phase === "scoreboard")
    return (
      <div className={VEIL_CLASS}>
        <ArenaScoreboard
          lines={clock.scoreboard}
          names={crewNames}
          secondsLeft={clock.secondsLeft ?? 0}
          onRematch={clock.backToLobby}
          onLeave={leave}
        />
      </div>
    );
  return null;
}
