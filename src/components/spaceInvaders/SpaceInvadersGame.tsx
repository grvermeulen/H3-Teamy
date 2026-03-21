"use client";

import * as Sentry from "@sentry/nextjs";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactPortal } from "react";
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

const touchGameButtonClass =
  "min-h-[58px] touch-manipulation text-lg font-semibold rounded-[10px] select-none [-webkit-user-select:none] [-webkit-touch-callout:none]";

const weaponLabel = (lvl: number) => {
  if (lvl <= 0) return "Basis";
  if (lvl === 1) return "Dubbel";
  if (lvl === 2) return "Drievoudig";
  if (lvl === 3) return "Vijfschot";
  return "Storm";
};

/**
 * Volledige Space Invaders-sessie in een modal overlay: canvas, HUD, touch- en toetsenbordbediening, opslag en highscores.
 */
export default function SpaceInvadersGame({
  initialState,
  onClose,
}: Props): ReactPortal | null {
  const dialogRef = useRef<HTMLDivElement>(null);
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
  /** Mobile-first: show thumb controls unless wide + fine pointer */
  const [showTouchBar, setShowTouchBar] = useState(true);
  const [showFirstTouchTip, setShowFirstTouchTip] = useState(false);
  const [lowViewport, setLowViewport] = useState(false);

  useLayoutEffect(() => {
    dialogRef.current?.focus();
  }, []);

  /** Focus binnen de dialog houden; Escape sluit de overlay; focus herstellen bij unmount. */
  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const root = dialogRef.current;
      const sel =
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const nodes = [...root.querySelectorAll<HTMLElement>(sel)].filter((el) =>
        root.contains(el),
      );
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      prevFocused?.focus?.();
    };
  }, [onClose]);

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
    } catch (error: unknown) {
      Sentry.captureException(error);
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
          } catch (error: unknown) {
            Sentry.captureException(error);
            stateRef.current = { ...cur, status: "paused" };
            inputRef.current = {
              moveLeft: false,
              moveRight: false,
              fire: false,
            };
            syncHud(stateRef.current);
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
    } catch (error: unknown) {
      Sentry.captureException(error);
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
      if (e.code === "KeyP") {
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
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Space Invaders"
      tabIndex={-1}
      className="fixed inset-0 z-[3200] flex min-h-dvh flex-col touch-none bg-[#010409] pt-safe pb-safe-bottom-bar pl-safe pr-safe"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#21262d] px-3 py-2">
        <div className="flex flex-wrap gap-2.5 text-sm text-[#c9d1d9]">
          <span>Score {hud.score}</span>
          <span>Golf {hud.wave}</span>
          <span>Levens {hud.lives}</span>
          <span>Wapen {weaponLabel(hud.weaponLevel)}</span>
          <span>Schild {hud.shieldCharges}</span>
        </div>
        <div className="flex flex-wrap gap-2">
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

      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="block h-full w-full touch-none"
          aria-label="Space Invaders speelveld"
        />
      </div>

      {showTouchBar && lowViewport ? (
        <p className="muted mx-2 mt-1 mb-0 shrink-0 text-center text-[11px]">
          Laag scherm — draai eventueel voor meer ruimte; gebruik de knoppen
          onderaan.
        </p>
      ) : null}

      {showTouchBar && showFirstTouchTip ? (
        <div className="mx-3 mt-2 shrink-0 rounded-lg border border-[#30363d] bg-[#21262d] px-3 py-2.5">
          <p className="mb-2 text-sm text-[#c9d1d9]">
            Sleepstand: gebruik de grote knoppen hieronder (boven de menubalk)
            om te bewegen en te schieten.
          </p>
          <button type="button" onClick={dismissTouchTip}>
            OK
          </button>
        </div>
      ) : null}

      {showTouchBar ? (
        <div className="grid shrink-0 grid-cols-3 gap-3.5 border-t border-[#30363d] bg-gradient-to-b from-[#0d1117] to-[#010409] px-3.5 pt-3.5 pb-2.5 select-none [-webkit-user-select:none] [-webkit-touch-callout:none]">
          <button
            type="button"
            className={touchGameButtonClass}
            onPointerDown={(e) => {
              e.preventDefault();
              setMoveLeft(true);
            }}
            onPointerUp={() => setMoveLeft(false)}
            onPointerLeave={() => setMoveLeft(false)}
            onPointerCancel={() => setMoveLeft(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            ← Links
          </button>
          <button
            type="button"
            className={touchGameButtonClass}
            onPointerDown={(e) => {
              e.preventDefault();
              setFire(true);
            }}
            onPointerUp={() => setFire(false)}
            onPointerLeave={() => setFire(false)}
            onPointerCancel={() => setFire(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            Vuur
          </button>
          <button
            type="button"
            className={touchGameButtonClass}
            onPointerDown={(e) => {
              e.preventDefault();
              setMoveRight(true);
            }}
            onPointerUp={() => setMoveRight(false)}
            onPointerLeave={() => setMoveRight(false)}
            onPointerCancel={() => setMoveRight(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            Rechts →
          </button>
        </div>
      ) : null}
      <p className="muted mx-2 mb-2 mt-0 shrink-0 text-center text-xs">
        {showTouchBar
          ? "Ook: pijltoetsen of A/D, spatie schieten, P pauze, Esc sluit."
          : "Toetsenbord: ← → of A D, spatie schieten, P pauze, Esc sluit."}
      </p>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
