"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";

/** One line of the ranglijst, as the route serves it. */
type LeaderboardRow = {
  userId: string;
  firstName: string;
  wins: number;
  kills: number;
  deaths: number;
  score: number;
  cashEarned: number;
};

/** What the panel knows right now. */
type State =
  | { status: "loading" }
  | { status: "ready"; rows: LeaderboardRow[] }
  | { status: "offline" };

/** Two digits, matching the manifest register used across the arena. */
function place(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * The ranglijst on the launcher card.
 *
 * Loaded when it is opened rather than with the card, so a player who never looks at it never
 * pays for the query.
 *
 * @returns The panel.
 */
export function ArenaLeaderboard(): React.JSX.Element {
  const [state, setState] = useState<State>({ status: "loading" });
  const [version, setVersion] = useState<1 | 2>(2);

  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(
          `/api/arena/leaderboard?version=${version}`,
        );
        if (!response.ok) throw new Error(`ranglijst ${response.status}`);
        const body = (await response.json()) as { rows?: LeaderboardRow[] };
        if (!alive) return;
        setState(
          Array.isArray(body.rows)
            ? { status: "ready", rows: body.rows }
            : { status: "offline" },
        );
      } catch (error: unknown) {
        Sentry.captureException(error, {
          tags: { area: "arena", kind: "leaderboard-load" },
        });
        if (alive) setState({ status: "offline" });
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [version]);

  const switcher = (
    <button
      type="button"
      className="mt-2 min-h-11 text-xs underline"
      onClick={() => {
        setState({ status: "loading" });
        setVersion(version === 2 ? 1 : 2);
      }}
    >
      {version === 2
        ? "Historische uitslagen (oude puntentelling)"
        : "Terug naar missies en geldscore"}
    </button>
  );

  if (state.status === "loading")
    return (
      <div role="status" aria-busy="true" className="arena-card mt-1.5 p-3">
        <span className="arena-label text-[var(--arena-dim)]">
          Ranglijst laden…
        </span>
      </div>
    );

  if (state.status === "offline" || state.rows.length === 0)
    return (
      <div className="arena-card mt-1.5 p-3">
        <span className="arena-label text-[var(--arena-dim)]">Ranglijst</span>
        <p className="mt-1.5 text-[13px] text-[var(--arena-dim)]">
          Nog geen potjes gespeeld. Speel er een met z&apos;n tweeën om de
          ranglijst te openen.
        </p>
        {switcher}
      </div>
    );

  return (
    <div className="arena-card mt-1.5 p-3">
      <span className="arena-label block text-[var(--arena-amber)]">
        Ranglijst · top {state.rows.length}
        {version === 1 ? " · historische uitslagen" : " · missies en geldscore"}
      </span>
      <ul className="mt-2 flex flex-col gap-1">
        {state.rows.map((row, index) => (
          <li
            key={row.userId}
            className="flex items-center gap-3 border-b border-[var(--arena-line)] pb-1 last:border-b-0"
          >
            <span className="arena-display w-7 shrink-0 text-sm text-[var(--arena-dim)]">
              {place(index)}
            </span>
            <span className="arena-label min-w-0 flex-1 truncate text-[var(--arena-text)]">
              {row.firstName}
            </span>
            <span className="shrink-0 text-[11px] uppercase tracking-wider text-[var(--arena-dim)] tabular-nums">
              <span className="text-[var(--arena-text)]">{row.wins}</span> gew ·{" "}
              <span className="text-[var(--arena-text)]">{row.score ?? 0}</span>{" "}
              punten · €{row.cashEarned ?? 0}
            </span>
          </li>
        ))}
      </ul>
      {switcher}
    </div>
  );
}
