import { describe, expect, it } from "vitest";
import { createFrameMetrics } from "./debugMetrics";

describe("createFrameMetrics", () => {
  it("includes stalls in wall-clock fps and reports frame percentiles", () => {
    const metrics = createFrameMetrics(10);
    for (let index = 0; index < 20; index++)
      metrics.record({
        frameMs: index === 19 ? 100 : 16.67,
        drawMs: index === 19 ? 30 : 4,
        simMs: 1,
      });
    const snapshot = metrics.snapshot();
    expect(snapshot.samples).toBe(10);
    expect(snapshot.fps).toBe(40);
    expect(snapshot.frameP50Ms).toBe(16.67);
    expect(snapshot.frameP99Ms).toBe(100);
    expect(snapshot.sessionFrames).toBe(20);
    expect(snapshot.frameP95Ms).toBe(100);
    expect(snapshot.drawP95Ms).toBe(30);
    expect(snapshot.simP95Ms).toBe(1);
  });

  it("is empty before any sample", () => {
    expect(createFrameMetrics().snapshot()).toMatchObject({
      fps: 0,
      frameP95Ms: 0,
      drawP95Ms: 0,
      simP95Ms: 0,
      samples: 0,
      sessionFrames: 0,
      sessionWorstFrameMs: 0,
    });
  });

  it("retains a long stall in the session summary after it leaves the recent window", () => {
    const metrics = createFrameMetrics(3);
    metrics.record({ frameMs: 500, drawMs: 5, simMs: 1 });
    for (let index = 0; index < 3; index += 1)
      metrics.record({ frameMs: 16, drawMs: 4, simMs: 1 });
    expect(metrics.snapshot()).toMatchObject({
      samples: 3,
      frameP99Ms: 16,
      sessionFrames: 4,
      sessionWorstFrameMs: 500,
      sessionLongFrames: 1,
      sessionSeconds: 0.548,
    });
  });
});
