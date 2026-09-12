"use client";

import { useEffect, useRef } from "react";
import {
  drawRadar,
  RADAR_SIZE_PX,
  type RadarSnapshot,
} from "@/lib/cityArena/render/radar";

/** Props for the accessible radar canvas. */
export type ArenaRadarProps = { snapshot: RadarSnapshot };

/** Paints the fixed-size radar whenever its pure snapshot changes. */
export default function ArenaRadar({
  snapshot,
}: ArenaRadarProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(RADAR_SIZE_PX * dpr);
    canvas.height = Math.round(RADAR_SIZE_PX * dpr);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRadar(context, snapshot, RADAR_SIZE_PX);
  }, [snapshot]);
  const summary = `Radar: ${snapshot.police.length} politie, ${snapshot.pickups.length} items, ${snapshot.tanks.length} tanks`;
  return (
    <div className="pointer-events-none absolute right-3 top-3 rounded-full">
      <canvas
        ref={canvasRef}
        width={RADAR_SIZE_PX}
        height={RADAR_SIZE_PX}
        aria-label="Radar"
        className="h-[90px] w-[90px]"
      />
      <span className="sr-only">{summary}</span>
    </div>
  );
}
