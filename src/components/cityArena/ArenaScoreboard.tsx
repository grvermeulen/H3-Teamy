"use client";

import type { ScoreLine } from "@/lib/cityArena/net/scoreboard";
import { ATTRIBUTION_TEXT } from "./ArenaLoadingScreen";

/** Props for {@link ArenaScoreboard}. */
export type ArenaScoreboardProps = {
  lines: ScoreLine[];
  /** Names by player id; a player the client never saw named falls back to their seat. */
  names: ReadonlyMap<number, string>;
  /** Seconds until the room returns to its lobby. */
  secondsLeft: number;
  /** The host's way back to the lobby; absent for everyone else, who follow the host's clock. */
  onRematch?: () => void;
  onLeave: () => void;
};

/** Two digits, matching the manifest register used elsewhere. */
function place(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** One line of the scorebord. */
function ScoreRowView({
  line,
  index,
  name,
}: {
  line: ScoreLine;
  index: number;
  name: string;
}): React.JSX.Element {
  return (
    <li
      className={`flex items-center gap-3 border border-[var(--arena-line)] border-l-[3px] px-3 py-2.5 ${
        line.isWinner
          ? "border-l-[var(--arena-amber)] bg-[var(--arena-amber-dim)]"
          : "border-l-[var(--arena-line-strong)] bg-[var(--arena-panel)]"
      }`}
    >
      <span
        className={`arena-display w-8 shrink-0 text-lg leading-none ${
          line.isWinner
            ? "text-[var(--arena-amber)]"
            : "text-[var(--arena-dim)]"
        }`}
      >
        {place(index)}
      </span>
      <span className="arena-label min-w-0 flex-1 truncate text-[var(--arena-text)]">
        {line.isYou ? "Jij" : name}
        {line.isWinner ? (
          <span className="ml-2 text-[var(--arena-amber)]">· Winnaar</span>
        ) : null}
      </span>
      <span className="shrink-0 text-right text-[11px] uppercase tracking-wider text-[var(--arena-dim)] tabular-nums">
        <span className="text-[var(--arena-text)]">{line.kills}</span> kills ·{" "}
        <span className="text-[var(--arena-text)]">{line.deaths}</span> deaths
      </span>
    </li>
  );
}

/**
 * The scorebord shown for ten seconds after a potje (spec §2).
 *
 * The host posts these lines to `POST /api/arena/matches` the moment play ends, which is what
 * the launcher's ranglijst is built from; this panel only draws them.
 *
 * @param props - The ranked lines, names, remaining time and the two actions.
 * @returns The scorebord panel.
 */
export function ArenaScoreboard({
  lines,
  names,
  secondsLeft,
  onRematch,
  onLeave,
}: ArenaScoreboardProps): React.JSX.Element {
  const nobodyScored = lines.every((line) => line.kills === 0);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="arena-label block text-[var(--arena-amber)]">
            Potje afgelopen
          </span>
          <h2 className="arena-display mt-1 text-2xl text-[var(--arena-text)] sm:text-3xl">
            Scorebord
          </h2>
        </div>
        <span className="arena-label shrink-0 border border-[var(--arena-line-strong)] px-2 py-1 text-[var(--arena-text)] tabular-nums">
          {secondsLeft}s
        </span>
      </header>

      <ul className="flex flex-col gap-1.5">
        {lines.map((line, index) => (
          <ScoreRowView
            key={line.playerId}
            line={line}
            index={index}
            name={names.get(line.playerId) ?? `Speler ${line.playerId}`}
          />
        ))}
      </ul>

      {nobodyScored ? (
        <p className="border border-[var(--arena-line)] bg-[var(--arena-panel)] px-3 py-2.5 text-[12px] text-[var(--arena-dim)]">
          Niemand scoorde dit potje. Geen winnaar.
        </p>
      ) : null}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[var(--arena-line)] pt-3">
        <button
          type="button"
          onClick={onLeave}
          className="arena-label border border-transparent px-3 py-2.5 text-[var(--arena-dim)] transition hover:text-[var(--arena-alert)]"
        >
          Potje verlaten
        </button>
        {onRematch ? (
          <button
            type="button"
            onClick={onRematch}
            className="arena-label bg-[var(--arena-amber)] px-5 py-3.5 text-[var(--arena-void)] transition hover:brightness-110 active:scale-[0.99]"
          >
            Terug naar lobby
          </button>
        ) : null}
      </footer>
      <p className="text-[10px] text-[var(--arena-dim)]">{ATTRIBUTION_TEXT}</p>
    </section>
  );
}
