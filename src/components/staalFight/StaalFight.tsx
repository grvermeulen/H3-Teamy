"use client";

import { Bangers, Press_Start_2P } from "next/font/google";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FightAudio } from "@/lib/staalFight/audio";
import { FALLBACK_FONTS, type FightFonts } from "@/lib/staalFight/draw/shapes";
import { VIEW_H, VIEW_W } from "@/lib/staalFight/draw/stage";
import { FightPlayer } from "@/lib/staalFight/player";

const displayFont = Bangers({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});
const hudFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

/** Where the poster frame is taken from: the versus screen, just after "VS" lands. */
const POSTER_STORY_T = 1.4;
/** Longest wait for the sound before the fight starts anyway. */
const AUDIO_WAIT_MS = 5000;

type Phase = "poster" | "loading" | "playing" | "ended";

/** Fonts for the canvas, once the web fonts are in. */
function webFonts(): FightFonts {
  return {
    display: `${displayFont.style.fontFamily}, ${FALLBACK_FONTS.display}`,
    hud: `${hudFont.style.fontFamily}, ${FALLBACK_FONTS.hud}`,
  };
}

/** Resolves when `p` settles or after `ms`, whichever comes first. */
function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);
}

const BUTTON =
  "arena-label min-h-11 border border-[var(--arena-line-strong)] bg-[rgba(12,8,20,0.72)] px-3 py-2 text-[var(--arena-text)] backdrop-blur transition hover:border-[var(--arena-amber)] hover:text-[var(--arena-amber)]";

/**
 * Staal vs. Trump: a full-screen, Street Fighter-style fight animation with sound. The launcher
 * links here; the canvas fills the screen at 16:9 and the controls sit on top.
 */
export default function StaalFight(): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<FightPlayer | null>(null);
  const audioRef = useRef<FightAudio | null>(null);
  const [phase, setPhase] = useState<Phase>("poster");
  const [muted, setMuted] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const phaseRef = useRef<Phase>("poster");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const drawPoster = useCallback(() => {
    const player = playerRef.current;
    if (player && phaseRef.current !== "playing")
      player.renderAt(
        phaseRef.current === "ended"
          ? player.totalReal
          : player.warp.realAt(POSTER_STORY_T),
      );
  }, []);

  // Size the canvas to the largest 16:9 box that fits, at device resolution.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const fit = (): void => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const scale = Math.min(w / VIEW_W, h / VIEW_H);
      const cssW = Math.floor(VIEW_W * scale);
      const cssH = Math.floor(VIEW_H * scale);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      setPortrait(h > w * 1.1);
      drawPoster();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [drawPoster]);

  // The player, the poster frame, and the web fonts.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const calm =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const player = new FightPlayer({
      canvas,
      fonts: FALLBACK_FONTS,
      calm,
      onEnd: () => setPhase("ended"),
    });
    playerRef.current = player;
    setCanFullscreen(Boolean(document.fullscreenEnabled));
    drawPoster();
    let cancelled = false;
    const fonts = webFonts();
    void Promise.all([
      document.fonts?.load(`40px ${fonts.display}`),
      document.fonts?.load(`20px ${fonts.hud}`),
    ])
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        player.setFonts(fonts);
        drawPoster();
      });
    return () => {
      cancelled = true;
      player.stop();
      audioRef.current?.close();
      audioRef.current = null;
      playerRef.current = null;
    };
  }, [drawPoster]);

  const start = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    if (!audioRef.current) {
      setPhase("loading");
      audioRef.current = FightAudio.create();
      if (audioRef.current) {
        audioRef.current.setMuted(muted);
        await withTimeout(audioRef.current.load(), AUDIO_WAIT_MS);
      }
    }
    player.setAudio(audioRef.current);
    setPhase("playing");
    player.start();
  }, [muted]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      audioRef.current?.setMuted(!m);
      return !m;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    const wrap = wrapRef.current?.parentElement;
    if (!wrap) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrap.requestFullscreen?.().catch(() => undefined);
  }, []);

  return (
    <div
      className={`arena fixed inset-0 z-[3200] flex flex-col bg-black pt-safe pl-safe pr-safe ${displayFont.className}`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        ref={wrapRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Animatie: Staal vecht in arcadestijl tegen Trump, wint met een slow-motion finisher en drinkt daarna een welverdiend biertje."
          className="block touch-none select-none"
        />

        {phase === "poster" || phase === "loading" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-end gap-3 bg-gradient-to-t from-black/70 via-transparent to-transparent p-6 pb-24">
            <button
              type="button"
              onClick={() => void start()}
              disabled={phase === "loading"}
              autoFocus
              className="min-h-14 rounded-sm bg-[var(--arena-amber)] px-8 py-3 text-2xl tracking-wider text-[var(--arena-void)] shadow-[0_0_30px_rgba(245,165,36,0.55)] transition active:scale-[0.98] disabled:opacity-70"
            >
              {phase === "loading" ? "Geluid laden…" : "▶ Start het gevecht"}
            </button>
            <p className="arena-label text-[var(--arena-dim)]">
              Met geluid: zet je volume aan
            </p>
          </div>
        ) : null}

        {phase === "ended" ? (
          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-3 p-6 pb-24">
            <button
              type="button"
              onClick={() => void start()}
              autoFocus
              className="min-h-12 rounded-sm bg-[var(--arena-amber)] px-6 py-2 text-xl tracking-wider text-[var(--arena-void)]"
            >
              Nog een keer
            </button>
            <Link href="/" className={BUTTON}>
              Terug naar Teamy
            </Link>
          </div>
        ) : null}

        <div
          className={`absolute right-3 flex gap-2 opacity-80 transition hover:opacity-100 ${portrait ? "top-3" : "bottom-3"}`}
        >
          {canFullscreen ? (
            <button type="button" onClick={toggleFullscreen} className={BUTTON}>
              Volledig scherm
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={muted}
            className={BUTTON}
          >
            {muted ? "Geluid aan" : "Geluid uit"}
          </button>
          <Link href="/" className={BUTTON}>
            Sluiten
          </Link>
        </div>

        {portrait ? (
          <p className="arena-label pointer-events-none absolute inset-x-4 top-20 text-center text-[var(--arena-dim)]">
            Draai je telefoon voor groot beeld
          </p>
        ) : null}
      </div>
    </div>
  );
}
