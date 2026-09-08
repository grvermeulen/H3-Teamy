"use client";

import { useMemo } from "react";
import { ArenaCountdown } from "./ArenaCountdown";
import { ArenaLobby, type CrewMember } from "./ArenaLobby";
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
}: ArenaPhaseScreensProps): React.JSX.Element | null {
  const { zone } = room;
  const recording = useMemo(
    () => ({ roomCode: room.roomCode, zone, isHost: room.isHost }),
    [room.roomCode, room.isHost, zone],
  );
  const clock = useMatchClock(game, recording);
  const crewNames = useScoreboardNames(room.crew, clock.accounts);
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
          onRematch={room.isHost ? clock.backToLobby : undefined}
          onLeave={leave}
        />
      </div>
    );
  return null;
}
