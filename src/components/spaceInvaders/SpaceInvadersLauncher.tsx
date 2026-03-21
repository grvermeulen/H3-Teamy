"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { createInitialState } from "@/lib/spaceInvaders/game";
import { loadHighScores, loadSave } from "@/lib/spaceInvaders/storage";

const SpaceInvadersGame = dynamic(
  () => import("./SpaceInvadersGame").then((m) => m.default),
  {
    ssr: false,
    loading: () => <p className="muted p-4 text-center">Spel laden…</p>,
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
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Space Invader</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              Golven, willekeurige power-ups uit de lucht, schilden, explosies
              en wapenlevels tot Storm — alles lokaal op dit apparaat. Pauzeer,
              sla op en sluit wanneer je wilt.
            </div>
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {hasSave ? (
              <button type="button" onClick={openResume}>
                Doorgaan
              </button>
            ) : null}
            <button type="button" onClick={openNew}>
              {hasSave ? "Nieuw spel" : "Space Invader"}
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
