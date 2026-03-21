"use client";

import { useId, useMemo } from "react";

/** 11×8 klassieke invader-silhouet (1 = pixel aan) */
const INVADER_ROWS: string[] = [
  "00100000100",
  "00010001000",
  "00111111100",
  "01101110110",
  "11111111111",
  "10111111101",
  "10100000101",
  "00011011000",
];

type Props = {
  /** Breedte van het pixelraster (px) */
  size?: number;
  className?: string;
  /** Iets subtielere gloed (bijv. in compacte knop) */
  subtleGlow?: boolean;
  /** true = verborgen voor screenreaders (bijv. naast zichtbare knoptekst) */
  decorative?: boolean;
  /** Alleen als decorative false: korte omschrijving */
  "aria-label"?: string;
};

/**
 * Pixel-art Space Invader als SVG met neon-gradient en lichte gloed,
 * passend bij het spel-overlay-thema.
 */
export function SpaceInvaderLaunchIcon({
  size = 40,
  className = "",
  subtleGlow = false,
  decorative = true,
  "aria-label": ariaLabel,
}: Props) {
  const reactId = useId();
  const ids = useMemo(() => {
    const u = reactId.replace(/:/g, "");
    return {
      grad: `si-grad-${u}`,
      glow: `si-glow-${u}`,
    };
  }, [reactId]);

  const cols = 11;
  const rows = INVADER_ROWS.length;
  const cell = size / cols;
  const height = cell * rows;

  const pixels: { x: number; y: number }[] = [];
  for (let y = 0; y < rows; y++) {
    const row = INVADER_ROWS[y]!;
    for (let x = 0; x < cols; x++) {
      if (row[x] === "1") pixels.push({ x, y });
    }
  }

  const blur = subtleGlow ? 1.2 : 2.2;
  const flood = subtleGlow ? "0.35" : "0.55";

  return (
    <svg
      width={size}
      height={height}
      viewBox={`0 0 ${size} ${height}`}
      className={className}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : "img"}
      aria-label={
        decorative ? undefined : (ariaLabel ?? "Space Invader pixelicoon")
      }
    >
      {!decorative ? (
        <title>{ariaLabel ?? "Space Invader pixelicoon"}</title>
      ) : null}
      <defs>
        <linearGradient id={ids.grad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="45%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
        <filter id={ids.glow} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation={blur} result="blur" />
          <feFlood floodColor="#22d3ee" floodOpacity={flood} result="color" />
          <feComposite in="color" in2="blur" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${ids.glow})`}>
        {pixels.map((p) => (
          <rect
            key={`${p.x}-${p.y}`}
            x={p.x * cell}
            y={p.y * cell}
            width={cell}
            height={cell}
            fill={`url(#${ids.grad})`}
            rx={cell * 0.12}
            ry={cell * 0.12}
          />
        ))}
      </g>
    </svg>
  );
}
