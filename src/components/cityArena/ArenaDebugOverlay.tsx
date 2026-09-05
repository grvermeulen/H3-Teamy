"use client";

import type { MetricsSnapshot } from "@/lib/cityArena/debugMetrics";
import type { Camera } from "@/lib/cityArena/render/camera";
import type { ArenaPlayerState } from "@/lib/cityArena/sim/types";

/** Number of bytes in one mebibyte, for formatting the cached-chunk size. */
const BYTES_PER_MEBIBYTE = 1024 * 1024;

/** Byte-cache footprint of the loaded map chunks. */
type ChunkStats = { chunks: number; bytes: number };

/** Entity counts and invariant violations of the running simulation. */
export type EntityCounts = {
  vehicles: number;
  bullets: number;
  effects: number;
  violations: number;
};

/** Props for {@link ArenaDebugOverlay}. */
type ArenaDebugOverlayProps = {
  metrics: MetricsSnapshot;
  chunks: ChunkStats;
  tiles: number;
  camera: Camera;
  player: ArenaPlayerState;
  routeMetres: number | null;
  entities: EntityCounts;
};

/** One formatted line per row of the {@link ArenaDebugOverlay} panel. */
function debugLines({
  metrics,
  chunks,
  tiles,
  camera,
  player,
  routeMetres,
  entities,
}: ArenaDebugOverlayProps): string[] {
  const chunkSizeMb = (chunks.bytes / BYTES_PER_MEBIBYTE).toFixed(1);
  const route = routeMetres === null ? "—" : `${Math.round(routeMetres)} m`;
  return [
    `fps ${metrics.fps} · frame p95 ${metrics.frameP95Ms.toFixed(1)} ms`,
    `tekenen p95 ${metrics.drawP95Ms.toFixed(1)} ms · simulatie p95 ${metrics.simP95Ms.toFixed(1)} ms`,
    `blokken ${chunks.chunks} (${chunkSizeMb} MB) · tegels ${tiles}`,
    `camera ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)} · zoom ${camera.zoom}`,
    `speler ${player.x.toFixed(1)}, ${player.y.toFixed(1)} · ${player.speed.toFixed(1)} m/s`,
    `route ${route}`,
    `auto's ${entities.vehicles} · kogels ${entities.bullets} · effecten ${entities.effects} · schendingen ${entities.violations}`,
  ];
}

/** `?debug=1` panel with frame timings, cache sizes and world positions. */
export default function ArenaDebugOverlay(
  props: ArenaDebugOverlayProps,
): React.JSX.Element {
  return (
    <div
      data-testid="arena-debug"
      className="pointer-events-none absolute right-2 top-2 z-20 rounded bg-black/70 px-2 py-1 font-mono text-[11px] leading-4 text-white"
    >
      {debugLines(props).map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}
