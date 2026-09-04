import * as Sentry from "@sentry/nextjs";

/** The subset of `CanvasRenderingContext2D` the renderer uses; tests inject recording fakes. */
export type RasterContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "translate"
  | "scale"
  | "rotate"
  | "setTransform"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "rect"
  | "clip"
  | "fill"
  | "stroke"
  | "fillRect"
  | "clearRect"
  | "fillText"
  | "strokeText"
  | "drawImage"
  | "arc"
  | "setLineDash"
> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
};

/** A drawable surface plus its context. */
export type RasterTarget = {
  canvas: CanvasImageSource;
  ctx: RasterContext;
  width: number;
  height: number;
};

/** Creates raster targets; returns `null` where 2D contexts are unavailable (jsdom, old browsers). */
export type CanvasFactory = (
  widthPx: number,
  heightPx: number,
) => RasterTarget | null;

/** Reports a canvas-creation failure to Sentry and always returns `null`. */
function reportMissingContext(): null {
  Sentry.captureException(new Error("2D canvas context is unavailable"), {
    tags: { area: "arena", kind: "canvas" },
  });
  return null;
}

/** Factory backed by `OffscreenCanvas` when available, else a detached `<canvas>`. */
export function createDomCanvasFactory(): CanvasFactory {
  return (widthPx, heightPx) => {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(widthPx, heightPx);
      const context = canvas.getContext("2d");
      return context
        ? { canvas, ctx: context, width: widthPx, height: heightPx }
        : reportMissingContext();
    }
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = widthPx;
    canvas.height = heightPx;
    const context = canvas.getContext("2d");
    return context
      ? { canvas, ctx: context, width: widthPx, height: heightPx }
      : reportMissingContext();
  };
}
