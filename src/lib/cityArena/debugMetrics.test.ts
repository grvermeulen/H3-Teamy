import { describe, expect, it } from "vitest";
import { createFrameMetrics } from "./debugMetrics";

describe("createFrameMetrics", () => {
  it("reports fps from the median frame time and p95 timings", () => {
    const metrics = createFrameMetrics(10);
    for (let index = 0; index < 20; index++)
      metrics.record({
        frameMs: index === 19 ? 100 : 16.67,
        drawMs: index === 19 ? 30 : 4,
        simMs: 1,
      });
    const snapshot = metrics.snapshot();
    expect(snapshot.samples).toBe(10);
    expect(snapshot.fps).toBe(60);
    expect(snapshot.frameP95Ms).toBe(100);
    expect(snapshot.drawP95Ms).toBe(30);
    expect(snapshot.simP95Ms).toBe(1);
  });

  it("is empty before any sample", () => {
    expect(createFrameMetrics().snapshot()).toEqual({
      fps: 0,
      frameP95Ms: 0,
      drawP95Ms: 0,
      simP95Ms: 0,
      samples: 0,
    });
  });
});
