import * as Sentry from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDomCanvasFactory } from "./canvasTypes";

describe("createDomCanvasFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when jsdom has no 2D context (no OffscreenCanvas, no canvas package)", () => {
    const factory = createDomCanvasFactory();
    expect(factory(64, 64)).toBeNull();
  });

  it("reports the missing-context failure to Sentry with the canvas kind", () => {
    const factory = createDomCanvasFactory();
    factory(32, 48);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { area: "arena", kind: "canvas" } }),
    );
  });
});
