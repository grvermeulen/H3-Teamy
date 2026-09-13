/** Raw presentation interval and CPU work, in milliseconds. */
export type FrameSample = {
  frameMs: number;
  drawMs: number;
  simMs: number;
  rasterMs?: number;
  missingChunks?: number;
};

/** Recent-frame percentiles plus persistent totals for the visible session. */
export type MetricsSnapshot = {
  fps: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameP99Ms: number;
  worstFrameMs: number;
  longFrames: number;
  drawP95Ms: number;
  simP95Ms: number;
  rasterP95Ms: number;
  missingChunks: number;
  samples: number;
  sessionFrames: number;
  sessionSeconds: number;
  sessionFps: number;
  sessionWorstFrameMs: number;
  sessionLongFrames: number;
};

/** Bounded recent history with lifetime counters that do not conceal old stalls. */
export type FrameMetrics = {
  record(sample: FrameSample): void;
  snapshot(): MetricsSnapshot;
};

function percentile(sorted: number[], fraction: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ??
    0
  );
}

/** Creates a frame buffer; FPS is frames divided by elapsed wall-clock presentation time. */
export function createFrameMetrics(capacity = 600): FrameMetrics {
  const samples: FrameSample[] = [];
  let cursor = 0;
  let sessionFrames = 0;
  let sessionMs = 0;
  let sessionWorstFrameMs = 0;
  let sessionLongFrames = 0;
  let missingChunks = 0;
  return {
    record(sample) {
      if (!Number.isFinite(sample.frameMs) || sample.frameMs < 0) return;
      if (samples.length < capacity) samples.push(sample);
      else {
        samples[cursor] = sample;
        cursor = (cursor + 1) % capacity;
      }
      sessionFrames += 1;
      sessionMs += sample.frameMs;
      sessionWorstFrameMs = Math.max(sessionWorstFrameMs, sample.frameMs);
      if (sample.frameMs > 50) sessionLongFrames += 1;
      missingChunks = sample.missingChunks ?? 0;
    },
    snapshot() {
      const sorted = (read: (sample: FrameSample) => number) =>
        samples.map(read).sort((a, b) => a - b);
      const frameTimes = sorted((sample) => sample.frameMs);
      const elapsed = frameTimes.reduce((sum, value) => sum + value, 0);
      return {
        fps: elapsed > 0 ? Math.round((samples.length * 1000) / elapsed) : 0,
        frameP50Ms: percentile(frameTimes, 0.5),
        frameP95Ms: percentile(frameTimes, 0.95),
        frameP99Ms: percentile(frameTimes, 0.99),
        worstFrameMs: frameTimes.at(-1) ?? 0,
        longFrames: frameTimes.filter((value) => value > 50).length,
        drawP95Ms: percentile(
          sorted((sample) => sample.drawMs),
          0.95,
        ),
        simP95Ms: percentile(
          sorted((sample) => sample.simMs),
          0.95,
        ),
        rasterP95Ms: percentile(
          sorted((sample) => sample.rasterMs ?? 0),
          0.95,
        ),
        missingChunks,
        samples: samples.length,
        sessionFrames,
        sessionSeconds: sessionMs / 1000,
        sessionFps:
          sessionMs > 0 ? Math.round((sessionFrames * 1000) / sessionMs) : 0,
        sessionWorstFrameMs,
        sessionLongFrames,
      };
    },
  };
}
