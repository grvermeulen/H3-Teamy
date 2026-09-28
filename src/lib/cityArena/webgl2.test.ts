import { describe, expect, it, vi } from "vitest";
import {
  hasWebGl2,
  isWebGl2Unavailable,
  WebGl2UnavailableError,
} from "./webgl2";

/** A document whose canvases answer a WebGL2 request with `context`. */
function documentWith(context: unknown): Document {
  const canvas = { getContext: vi.fn(() => context) };
  return {
    createElement: vi.fn(() => canvas),
  } as unknown as Document;
}

describe("hasWebGl2", () => {
  it("says no when the probe canvas offers no WebGL2 context", () => {
    expect(hasWebGl2(documentWith(null))).toBe(false);
  });

  it("says yes, and lets go of the probe's context straight away", () => {
    const loseContext = vi.fn();
    const context = {
      getExtension: vi.fn((name: string) =>
        name === "WEBGL_lose_context" ? { loseContext } : null,
      ),
    };
    expect(hasWebGl2(documentWith(context))).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("says yes where the context cannot be lost early", () => {
    expect(hasWebGl2(documentWith({ getExtension: () => null }))).toBe(true);
  });
});

describe("isWebGl2Unavailable", () => {
  it("recognises its own error by name, and nothing else", () => {
    expect(isWebGl2Unavailable(new WebGl2UnavailableError())).toBe(true);
    expect(isWebGl2Unavailable(new Error("WebGL2"))).toBe(false);
  });
});
