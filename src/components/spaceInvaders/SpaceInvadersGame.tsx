"use client";

import * as Sentry from "@sentry/nextjs";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { GAME_H, GAME_W } from "@/lib/spaceInvaders/constants";
import { drawGame } from "@/lib/spaceInvaders/draw";
import { createInitialState, tick } from "@/lib/spaceInvaders/game";
import {
  TOUCH_TIP_KEY,
  addHighScore,
  clearSave,
  saveGameToStorage,
} from "@/lib/spaceInvaders/storage";
import type { GameState } from "@/lib/spaceInvaders/types";

type InputRef = { moveLeft: boolean; moveRight: boolean; fire: boolean };

type Props = {
  initialState: GameState;
  onClose: () => void;
};

const weaponLabel = (lvl: number) => {
  if (lvl <= 0) return "Basis";
  if (lvl === 1) return "Dubbel";
  if (lvl === 2) return "Triple";
  if (lvl === 3) return "Salvo";
  return "Storm";
};

export default function SpaceInvadersGame({ initialState, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(initialState);
  const inputRef = useRef<InputRef>({
    moveLeft: false,
    moveRight: false,
    fire: false,
  });
  const lastTsRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const [hud, setHud] = useState({
    score: initialState.score,
    wave: initialState.wave,
    lives: initialState.lives,
    weaponLevel: initialState.weaponLevel,
    shieldCharges: initialState.shieldCharges,
    status: initialState.status,
  });
  const hudSnapRef = useRef({
    score: initialState.score,
    wave: initialState.wave,
    lives: initialState.lives,
    weaponLevel: initialState.weaponLevel,
    shieldCharges: initialState.shieldCharges,
    status: initialState.status,
  });
  const drawTimeRef = useRef(0);
  const [mounted, setMounted] = useState(false);
  /** Mobile-first: show thumb controls unless wide + fine pointer */
  const [showTouchBar, setShowTouchBar] = useState(true);
  const [showFirstTouchTip, setShowFirstTouchTip] = useState(false);
  const [lowViewport, setLowViewport] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const q = window.matchMedia("(max-width: 768px), (pointer: coarse)");
    const apply = () => setShowTouchBar(q.matches);
    apply();
    q.addEventListener("change", apply);
    return () => q.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!showTouchBar) return;
    try {
      if (!localStorage.getItem(TOUCH_TIP_KEY)) setShowFirstTouchTip(true);
    } catch {
      /* ignore */
    }
  }, [showTouchBar]);

  useEffect(() => {
    const check = () => setLowViewport(window.innerHeight < 460);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const syncHud = useCallback((s: GameState) => {
    const prev = hudSnapRef.current;
    if (
      prev.score === s.score &&
      prev.wave === s.wave &&
      prev.lives === s.lives &&
      prev.weaponLevel === s.weaponLevel &&
      prev.shieldCharges === s.shieldCharges &&
      prev.status === s.status
    ) {
      return;
    }
    const next = {
      score: s.score,
      wave: s.wave,
      lives: s.lives,
      weaponLevel: s.weaponLevel,
      shieldCharges: s.shieldCharges,
      status: s.status,
    };
    hudSnapRef.current = next;
    setHud(next);
  }, []);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const w = rect.width;
    const h = rect.height;
    if (
      canvas.width !== Math.round(w * dpr) ||
      canvas.height !== Math.round(h * dpr)
    ) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(w / GAME_W, h / GAME_H);
    const ox = (w - GAME_W * scale) / 2;
    const oy = (h - GAME_H * scale) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    drawGame(ctx, stateRef.current, drawTimeRef.current);
  }, []);

  useLayoutEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => {
    const onResize = () => paint();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [paint]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const loop = (ts: number) => {
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      drawTimeRef.current = ts / 1000;
      if (last != null) {
        const dt = Math.min((ts - last) / 1000, 0.064);
        const cur = stateRef.current;
        if (cur.status === "playing" || cur.status === "wave_clear") {
          try {
            stateRef.current = tick(cur, dt, inputRef.current);
          } catch (e) {
            Sentry.captureException(e);
          }
        }
        syncHud(stateRef.current);
      }
      paint();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [paint, syncHud]);

  const dismissTouchTip = useCallback(() => {
    try {
      localStorage.setItem(TOUCH_TIP_KEY, "1");
    } catch {
      /* ignore */
    }
    setShowFirstTouchTip(false);
  }, []);

  const pauseToggle = useCallback(() => {
    const s = stateRef.current;
    if (s.status === "gameover" || s.status === "wave_clear") return;
    if (s.status === "playing") {
      stateRef.current = { ...s, status: "paused" };
    } else {
      stateRef.current = { ...s, status: "playing" };
    }
    syncHud(stateRef.current);
  }, [syncHud]);

  const saveAndExit = useCallback(() => {
    saveGameToStorage(stateRef.current);
    onClose();
  }, [onClose]);

  const restart = useCallback(() => {
    stateRef.current = createInitialState();
    clearSave();
    syncHud(stateRef.current);
  }, [syncHud]);

  const onGameOverHandled = useRef(false);
  useEffect(() => {
    if (hud.status === "gameover" && !onGameOverHandled.current) {
      onGameOverHandled.current = true;
      addHighScore({
        score: stateRef.current.score,
        wave: stateRef.current.wave,
        at: new Date().toISOString(),
      });
      clearSave();
    }
    if (hud.status !== "gameover") onGameOverHandled.current = false;
  }, [hud.status]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") {
        inputRef.current.moveLeft = true;
        e.preventDefault();
      }
      if (e.code === "ArrowRight" || e.code === "KeyD") {
        inputRef.current.moveRight = true;
        e.preventDefault();
      }
      if (e.code === "Space") {
        inputRef.current.fire = true;
        e.preventDefault();
      }
      if (e.code === "Escape" || e.code === "KeyP") {
        pauseToggle();
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA")
        inputRef.current.moveLeft = false;
      if (e.code === "ArrowRight" || e.code === "KeyD")
        inputRef.current.moveRight = false;
      if (e.code === "Space") inputRef.current.fire = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [pauseToggle]);

  const setMoveLeft = (v: boolean) => {
    inputRef.current.moveLeft = v;
  };
  const setMoveRight = (v: boolean) => {
    inputRef.current.moveRight = v;
  };
  const setFire = (v: boolean) => {
    inputRef.current.fire = v;
  };

  const overlay = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3200,
        minHeight: "100dvh",
        background: "#010409",
        display: "flex",
        flexDirection: "column",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "calc(76px + env(safe-area-inset-bottom, 0px))",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        touchAction: "none",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: "8px 12px",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #21262d",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            fontSize: 14,
            color: "#c9d1d9",
          }}
        >
          <span>Score {hud.score}</span>
          <span>Golf {hud.wave}</span>
          <span>Levens {hud.lives}</span>
          <span>Wapen {weaponLabel(hud.weaponLevel)}</span>
          <span>Schild {hud.shieldCharges}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            onClick={pauseToggle}
            disabled={hud.status === "wave_clear"}
          >
            {hud.status === "paused" ? "Hervatten" : "Pauze"}
          </button>
          <button type="button" onClick={saveAndExit}>
            Opslaan en sluiten
          </button>
          <button type="button" onClick={onClose}>
            Sluiten
          </button>
          {hud.status === "gameover" ? (
            <button type="button" onClick={restart}>
              Opnieuw
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            touchAction: "none",
          }}
          aria-label="Space Invaders speelveld"
        />
      </div>

      {showTouchBar && lowViewport ? (
        <p
          className="muted"
          style={{
            textAlign: "center",
            fontSize: 11,
            margin: "4px 8px 0",
            flexShrink: 0,
          }}
        >
          Laag scherm — draai eventueel voor meer ruimte; gebruik de knoppen
          onderaan.
        </p>
      ) : null}

      {showTouchBar && showFirstTouchTip ? (
        <div
          style={{
            flexShrink: 0,
            margin: "8px 12px 0",
            padding: "10px 12px",
            borderRadius: 8,
            background: "#21262d",
            border: "1px solid #30363d",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 14, color: "#c9d1d9" }}>
            Sleepstand: gebruik de grote knoppen hieronder (boven de menubalk)
            om te bewegen en te schieten.
          </p>
          <button type="button" onClick={dismissTouchTip}>
            OK
          </button>
        </div>
      ) : null}

      {showTouchBar ? (
        <div
          style={{
            flexShrink: 0,
            padding: "14px 14px 10px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 14,
            borderTop: "1px solid #30363d",
            background: "linear-gradient(180deg, #0d1117 0%, #010409 100%)",
          }}
        >
          <button
            type="button"
            style={{
              minHeight: 58,
              touchAction: "manipulation",
              fontSize: 18,
              fontWeight: 600,
              borderRadius: 10,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              setMoveLeft(true);
            }}
            onPointerUp={() => setMoveLeft(false)}
            onPointerLeave={() => setMoveLeft(false)}
            onPointerCancel={() => setMoveLeft(false)}
          >
            ← Links
          </button>
          <button
            type="button"
            style={{
              minHeight: 58,
              touchAction: "manipulation",
              fontSize: 18,
              fontWeight: 600,
              borderRadius: 10,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              setFire(true);
            }}
            onPointerUp={() => setFire(false)}
            onPointerLeave={() => setFire(false)}
            onPointerCancel={() => setFire(false)}
          >
            Vuur
          </button>
          <button
            type="button"
            style={{
              minHeight: 58,
              touchAction: "manipulation",
              fontSize: 18,
              fontWeight: 600,
              borderRadius: 10,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              setMoveRight(true);
            }}
            onPointerUp={() => setMoveRight(false)}
            onPointerLeave={() => setMoveRight(false)}
            onPointerCancel={() => setMoveRight(false)}
          >
            Rechts →
          </button>
        </div>
      ) : null}
      <p
        className="muted"
        style={{
          textAlign: "center",
          fontSize: 12,
          margin: "0 8px 8px",
        }}
      >
        {showTouchBar
          ? "Ook: pijltoetsen of A/D, spatie schieten, P of Esc pauze."
          : "Toetsenbord: ← → of A D, spatie schieten, P of Esc pauze."}
      </p>
    </div>
  );

  if (!mounted) return null;
  return createPortal(overlay, document.body);
}
