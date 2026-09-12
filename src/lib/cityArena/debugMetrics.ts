/** One frame's timings in milliseconds. */
export type FrameSample = { frameMs: number; drawMs: number; simMs: number };

/** Aggregated timings over the samples currently held in the ring buffer. */
export type MetricsSnapshot = {
  fps: number;
  frameP95Ms: number;
  drawP95Ms: number;
  simP95Ms: number;
  samples: number;
};

/** Ring buffer of frame samples that reports fps and p95 timings on demand. */
export type FrameMetrics = {
  record(sample: FrameSample): void;
  snapshot(): MetricsSnapshot;
};

/** Default number of frames kept, roughly 2 s of history at 60 fps. */
const DEFAULT_METRICS_CAPACITY = 120;
/** Fraction used to read the median frame time for fps. */
const MEDIAN_FRACTION = 0.5;
/** Fraction used to read the p95 timings. */
const P95_FRACTION = 0.95;
/** Milliseconds per second, for converting a frame time into fps. */
const MS_PER_SECOND = 1000;

/** Value at `fraction` through the sorted list; `0` for an empty list. */
function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.floor(fraction * sorted.length),
  );
  return sorted[index];
}

/** Creates a metrics buffer holding the last `capacity` frames. */
export function createFrameMetrics(
  capacity = DEFAULT_METRICS_CAPACITY,
): FrameMetrics {
  const samples: FrameSample[] = [];
  return {
    record(sample) {
      samples.push(sample);
      if (samples.length > capacity) samples.shift();
    },
    snapshot() {
      const frameTimes = samples.map((sample) => sample.frameMs);
      const medianFrameMs = percentile(frameTimes, MEDIAN_FRACTION);
      return {
        fps: medianFrameMs > 0 ? Math.round(MS_PER_SECOND / medianFrameMs) : 0,
        frameP95Ms: percentile(frameTimes, P95_FRACTION),
        drawP95Ms: percentile(
          samples.map((sample) => sample.drawMs),
          P95_FRACTION,
        ),
        simP95Ms: percentile(
          samples.map((sample) => sample.simMs),
          P95_FRACTION,
        ),
        samples: samples.length,
      };
    },
  };
}
