"use client";

import { useEffect, useRef } from "react";
import { navigationLabel } from "@/lib/cityArena/world/navigation";
import {
  drawRadar,
  RADAR_SIZE_PX,
  type RadarSnapshot,
} from "@/lib/cityArena/render/radar";

/** Props for the accessible radar canvas. */
export type ArenaRadarProps = {
  snapshot: RadarSnapshot;
  onOpen?: () => void;
  disabled?: boolean;
};

/** Paints the fixed-size radar whenever its pure snapshot changes. */
export default function ArenaRadar({
  snapshot,
  onOpen,
  disabled,
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
    <div className="absolute right-3 top-3 z-10 flex max-w-[180px] flex-col items-end gap-2">
      <button
        type="button"
        aria-label="Kaart openen"
        onClick={onOpen}
        disabled={disabled}
        className="rounded-full border border-slate-500 bg-slate-950/80 p-1 focus-visible:outline-2 focus-visible:outline-cyan-300"
      >
        <canvas
          ref={canvasRef}
          width={RADAR_SIZE_PX}
          height={RADAR_SIZE_PX}
          aria-label="Radar"
          className="h-[90px] w-[90px]"
        />
        <span className="sr-only">{summary}</span>
      </button>
      {snapshot.navigation ? (
        <button
          type="button"
          onClick={onOpen}
          disabled={disabled}
          className="rounded-lg bg-slate-950/90 px-3 py-2 text-right text-xs text-cyan-200"
        >
          {navigationLabel(snapshot.navigation)}
        </button>
      ) : null}
    </div>
  );
}
