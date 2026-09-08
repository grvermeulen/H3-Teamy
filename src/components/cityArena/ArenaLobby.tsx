"use client";

import { ROOM_CAPACITY } from "@/lib/cityArena/net/room";
import type { ConnectionState } from "@/lib/cityArena/net/transport";
import { ATTRIBUTION_TEXT } from "./ArenaLoadingScreen";
import { ConnectionDot } from "./ConnectionBanner";
import { zoneName, zoneSector } from "./launcher/MissionCard";

/** One member of the crew, as the lobby draws them. */
export type CrewMember = {
  clientId: string;
  /** Position in join order — a display order, not the player id, which the host hands out. */
  seat: number;
  name: string;
  isHost: boolean;
  /** True for the player looking at this screen; they are labelled "JIJ". */
  isYou: boolean;
};

/**
 * The four crew accents, assigned by seat so a member keeps their colour.
 *
 * Held as class pairs rather than a colour value because the repo forbids inline `style` props,
 * and Tailwind needs the class to appear literally to emit it.
 */
const CREW_ACCENTS = [
  {
    rule: "border-l-[var(--arena-crew-1)]",
    text: "text-[var(--arena-crew-1)]",
  },
  {
    rule: "border-l-[var(--arena-crew-2)]",
    text: "text-[var(--arena-crew-2)]",
  },
  {
    rule: "border-l-[var(--arena-crew-3)]",
    text: "text-[var(--arena-crew-3)]",
  },
  {
    rule: "border-l-[var(--arena-crew-4)]",
    text: "text-[var(--arena-crew-4)]",
  },
] as const;

/** Props for {@link ArenaLobby}. */
export type ArenaLobbyProps = {
  roomCode: string;
  zone: string;
  crew: CrewMember[];
  connection: ConnectionState;
  /** True when this client is the host and therefore owns the start button. */
  isHost: boolean;
  onStart: () => void;
  onEnterCode: () => void;
  onLeave: () => void;
};

/** Two digits, matching the manifest register used on the launcher. */
function seatNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** One crew tile. */
function CrewTile({
  member,
  index,
}: {
  member: CrewMember;
  index: number;
}): React.JSX.Element {
  const accent = CREW_ACCENTS[index % CREW_ACCENTS.length]!;
  return (
    <li
      className={`min-w-0 flex-1 basis-[140px] border border-[var(--arena-line)] border-l-[3px] bg-[var(--arena-panel)] p-2.5 ${accent.rule}`}
    >
      <span
        className={`arena-display block text-lg leading-none ${accent.text}`}
      >
        {seatNumber(index)}
      </span>
      <span className="arena-label mt-1.5 block truncate text-[var(--arena-text)]">
        {member.isYou ? "Jij" : member.name}
      </span>
      <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-[var(--arena-dim)]">
        {member.isHost ? "Host" : "Online"}
      </span>
    </li>
  );
}

/** The stylised zone preview on the right of the manifest. */
function ZonePanel({ zone }: { zone: string }): React.JSX.Element {
  return (
    <div className="arena-grid relative h-[132px] w-full shrink-0 border border-[var(--arena-line)] bg-[var(--arena-void)] sm:w-[200px]">
      <span className="arena-label absolute left-2 top-2 text-[9px] text-[var(--arena-dim)]">
        Gekozen zone
      </span>
      <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--arena-amber)] shadow-[0_0_14px_3px_rgba(245,165,36,0.55)]" />
      <span className="arena-label absolute bottom-2 right-2 text-[9px] text-[var(--arena-online)]">
        {zoneSector(zone)}
      </span>
    </div>
  );
}

/** The host's start button, or the reason it is not yours to press. */
function HostAction({
  isHost,
  crewSize,
  onStart,
}: {
  isHost: boolean;
  crewSize: number;
  onStart: () => void;
}): React.JSX.Element {
  // Alone in the lobby the button reads "Oefenen": a solo potje is never recorded (the host
  // only posts a result with two or more players), so the label says what will happen.
  const alone = crewSize <= 1;
  if (!isHost)
    return (
      <div className="text-right">
        <span className="arena-label block text-[var(--arena-dim)]">
          Host actie
        </span>
        <span className="mt-1 block text-[13px] text-[var(--arena-dim)]">
          Alleen de host kan het potje starten.
        </span>
      </div>
    );
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <span className="arena-label block text-[var(--arena-dim)]">
          Host actie
        </span>
        <span className="arena-label mt-1 block text-[var(--arena-text)]">
          {alone
            ? "Oefenen · alleen jij"
            : `Start · ${seatNumber(crewSize - 1)} spelers klaar`}
        </span>
      </div>
      <button
        type="button"
        onClick={onStart}
        className="arena-label bg-[var(--arena-amber)] px-5 py-3.5 text-[var(--arena-void)] transition hover:brightness-110 active:scale-[0.99]"
      >
        {alone ? "Oefenen" : "Start potje"}
      </button>
    </div>
  );
}

/**
 * The lobby: who is in the room, which zone, and the host's start action.
 *
 * The city keeps running behind this panel — members free-roam the whole map while they wait
 * (spec §2), which is why the helper text tells them so rather than showing a spinner.
 *
 * @param props - The room, its crew, the connection state and the actions.
 * @returns The lobby panel.
 */
export function ArenaLobby({
  roomCode,
  zone,
  crew,
  connection,
  isHost,
  onStart,
  onEnterCode,
  onLeave,
}: ArenaLobbyProps): React.JSX.Element {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="arena-label block text-[var(--arena-amber)]">
            Room {roomCode} · Lobby
          </span>
          <h2 className="arena-display mt-1 text-2xl text-[var(--arena-text)] sm:truncate sm:text-3xl">
            {zoneName(zone)}
          </h2>
        </div>
        <div className="shrink-0 text-right">
          <span className="arena-label block border border-[var(--arena-line-strong)] px-2 py-1 text-[var(--arena-text)] tabular-nums">
            {crew.length} / {ROOM_CAPACITY}
          </span>
          <span className="mt-1.5 block">
            <ConnectionDot state={connection} />
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="arena-label text-[var(--arena-dim)]">
            Crew manifest
          </span>
          <ul className="flex flex-wrap gap-2">
            {crew.map((member) => (
              <CrewTile
                key={member.clientId}
                member={member}
                index={member.seat}
              />
            ))}
          </ul>
          <p className="border border-[var(--arena-line)] bg-[var(--arena-panel)] px-3 py-2.5 text-[12px] text-[var(--arena-dim)]">
            De stad blijft actief terwijl je wacht. Verken de kaart of wacht tot
            de host het potje start.
          </p>
        </div>
        <ZonePanel zone={zone} />
      </div>

      <footer className="flex flex-wrap items-end justify-between gap-3 border-t border-[var(--arena-line)] pt-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onEnterCode}
            className="arena-label border border-[var(--arena-line-strong)] px-3 py-2.5 text-[var(--arena-text)] transition hover:border-[var(--arena-amber)] hover:text-[var(--arena-amber)]"
          >
            Code invoeren
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="arena-label border border-transparent px-3 py-2.5 text-[var(--arena-dim)] transition hover:text-[var(--arena-alert)]"
          >
            Potje verlaten
          </button>
        </div>
        <HostAction isHost={isHost} crewSize={crew.length} onStart={onStart} />
      </footer>
      <p className="text-[10px] text-[var(--arena-dim)]">{ATTRIBUTION_TEXT}</p>
    </section>
  );
}
