"use client";

import dynamic from "next/dynamic";
import { Press_Start_2P } from "next/font/google";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createInitialState } from "@/lib/spaceInvaders/game";
import { loadHighScores, loadSave } from "@/lib/spaceInvaders/storage";
import { SpaceInvaderLaunchIcon } from "./SpaceInvaderLaunchIcon";

const arcadeFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const arcadeLabelGlow: CSSProperties = {
  textShadow:
    "0 0 10px rgba(34,211,238,0.9), 0 0 22px rgba(167,139,250,0.4), 0 2px 0 rgba(0,0,0,0.85)",
};

/** Zelfde full-screen laag als het spel, zodat de chunk-load niet inline in de pagina staat. */
function SpaceInvadersChunkLoadingOverlay() {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[3200] flex flex-col items-center justify-center touch-none bg-[#010409] pt-safe pb-safe-bottom-bar pl-safe pr-safe"
    >
      <p className="muted p-4 text-center text-base">Spel laden…</p>
    </div>,
    document.body,
  );
}

const SpaceInvadersGame = dynamic(
  () => import("./SpaceInvadersGame").then((m) => m.default),
  {
    ssr: false,
    loading: () => <SpaceInvadersChunkLoadingOverlay />,
  },
);

export default function SpaceInvadersLauncher() {
  const [open, setOpen] = useState(false);
  const [bootState, setBootState] = useState<ReturnType<
    typeof createInitialState
  > | null>(null);
  const [scores, setScores] = useState(loadHighScores());
  const [hasSave, setHasSave] = useState(false);

  useEffect(() => {
    setHasSave(loadSave() != null);
  }, [open]);

  const openNew = useCallback(() => {
    setBootState(createInitialState());
    setOpen(true);
  }, []);

  const openResume = useCallback(() => {
    const s = loadSave();
    if (s) {
      setBootState(s);
      setOpen(true);
    }
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setBootState(null);
    setScores(loadHighScores());
    setHasSave(loadSave() != null);
  }, []);

  return (
    <>
      <div className="card" style={{ marginTop: 16 }}>
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "center", gap: 12 }}
        >
          <div className="grow min-w-0">
            <div className="flex flex-wrap items-start gap-3">
              <SpaceInvaderLaunchIcon
                size={52}
                decorative
                className="space-invader-launch-icon--hero shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div style={{ fontWeight: 600 }}>Space Invader</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  Golven, willekeurige power-ups uit de lucht, schilden,
                  explosies en wapenlevels tot Storm — alles lokaal op dit
                  apparaat. Pauzeer, sla op en sluit wanneer je wilt.
                </div>
              </div>
            </div>
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {hasSave ? (
              <button
                type="button"
                onClick={openResume}
                className="inline-flex items-center rounded-xl border border-white/15 bg-[#111926] px-3 py-2.5 text-sm font-medium text-[#c9d7ee] shadow-sm transition hover:border-cyan-500/35 hover:bg-[#151d2e] active:scale-[0.98]"
              >
                Doorgaan
              </button>
            ) : null}
            <button
              type="button"
              onClick={openNew}
              aria-label={
                hasSave
                  ? "Nieuw Space Invader-spel starten"
                  : "Space Invader starten"
              }
              className="inline-flex flex-col items-center justify-center gap-4 rounded-xl border border-cyan-500/50 bg-gradient-to-br from-cyan-900/95 via-[#0c1528] to-violet-900/95 px-4 py-3 shadow-[0_0_20px_-2px_rgba(34,211,238,0.55)] transition hover:border-cyan-400/70 hover:shadow-[0_0_32px_-2px_rgba(34,211,238,0.6)] active:scale-[0.98]"
            >
              <SpaceInvaderLaunchIcon size={36} decorative />
              {hasSave ? (
                <span
                  className={`${arcadeFont.className} max-w-[5.5rem] select-none text-center text-[8px] uppercase leading-tight text-[#a5f3fc]`}
                  style={arcadeLabelGlow}
                  aria-hidden
                >
                  <span className="block">Nieuw</span>
                  <span className="block">spel</span>
                </span>
              ) : (
                <span
                  className={`${arcadeFont.className} select-none text-[11px] uppercase tracking-wide text-[#a5f3fc]`}
                  style={arcadeLabelGlow}
                  aria-hidden
                >
                  Start
                </span>
              )}
            </button>
          </div>
        </div>
        {scores.length > 0 ? (
          <details style={{ marginTop: 12 }}>
            <summary className="muted">Topscores (lokaal)</summary>
            <ol style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
              {scores.map((s, i) => (
                <li key={`${s.at}-${i}`} style={{ fontSize: 14 }}>
                  {s.score} punten — golf {s.wave}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {" "}
                    (
                    {new Date(s.at).toLocaleString(undefined, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                    )
                  </span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
      {open && bootState ? (
        <SpaceInvadersGame initialState={bootState} onClose={handleClose} />
      ) : null}
    </>
  );
}
