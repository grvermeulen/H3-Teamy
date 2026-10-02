"use client";

import {
  formatFixed,
  type MetricsSnapshot,
} from "@/lib/cityArena/debugMetrics";
import { wireDiagnostics } from "@/lib/cityArena/net/wireValidation";
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
  peds: number;
  cops: number;
  traffic: number;
  pickups: number;
  wantedLevel: number;
  zoneSecondsLeft: number | null;
  eventCount: number;
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
  const chunkSizeMb = formatFixed(chunks.bytes / BYTES_PER_MEBIBYTE, 1);
  const zoneTimer =
    entities.zoneSecondsLeft === null
      ? "zone onbekend"
      : `${entities.zoneSecondsLeft}s`;
  const route = routeMetres === null ? "—" : `${Math.round(routeMetres)} m`;
  return [
    `fps ${metrics.fps} · frame p95 ${formatFixed(metrics.frameP95Ms, 1)} ms`,
    `frame p50 ${formatFixed(metrics.frameP50Ms, 1)} · p99 ${formatFixed(metrics.frameP99Ms, 1)} · max ${formatFixed(metrics.worstFrameMs, 1)} ms`,
    `sessie ${formatFixed(metrics.sessionSeconds, 0)} s · ${metrics.sessionFps} fps · max ${formatFixed(metrics.sessionWorstFrameMs, 1)} ms · traag ${metrics.sessionLongFrames}`,
    `tekenen p95 ${formatFixed(metrics.drawP95Ms, 1)} ms · simulatie p95 ${formatFixed(metrics.simP95Ms, 1)} ms`,
    `raster p95 ${formatFixed(metrics.rasterP95Ms, 1)} ms · ontbrekend ${metrics.missingChunks} · geweigerd ${JSON.stringify(wireDiagnostics())}`,
    `blokken ${chunks.chunks} (${chunkSizeMb} MB) · tegels ${tiles}`,
    `camera ${formatFixed(camera.x, 1)}, ${formatFixed(camera.y, 1)} · zoom ${camera.zoom}`,
    `speler ${formatFixed(player.x, 1)}, ${formatFixed(player.y, 1)} · ${formatFixed(player.speed, 1)} m/s`,
    `route ${route}`,
    `verkeer ${entities.traffic} · voetgangers ${entities.peds} · agenten ${entities.cops}`,
    `pickups ${entities.pickups} · wanted ${entities.wantedLevel} · zone ${zoneTimer} · events ${entities.eventCount}`,
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
