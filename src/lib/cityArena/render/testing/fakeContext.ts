import type { RasterContext, RasterTarget } from "../canvasTypes";

/** A 2D context that records every call so tests can assert paint order. */
export type FakeContext = RasterContext & { calls: string[] };

/** Decimal places kept when a numeric call argument is logged. */
const CALL_LOG_DECIMALS = 100;

/** Formats one recorded call argument; numbers are rounded for stable comparisons. */
function formatCallArg(arg: unknown): string {
  return typeof arg === "number"
    ? String(Math.round(arg * CALL_LOG_DECIMALS) / CALL_LOG_DECIMALS)
    : String(arg);
}

/** Builds a recorder for one method name, appending `name(arg1,arg2,…)` to `calls`. */
function createRecorder(
  calls: string[],
): (name: string) => (...args: unknown[]) => void {
  return (name: string) =>
    (...args: unknown[]): void => {
      calls.push(`${name}(${args.map(formatCallArg).join(",")})`);
    };
}

/** Creates a fake context; each method appends `name(arg1,arg2,…)` to `calls`. */
export function createFakeContext(): FakeContext {
  const calls: string[] = [];
  const record = createRecorder(calls);
  const context: FakeContext = {
    calls,
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    save: record("save"),
    restore: record("restore"),
    translate: record("translate"),
    scale: record("scale"),
    rotate: record("rotate"),
    setTransform: record("setTransform"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    closePath: record("closePath"),
    rect: record("rect"),
    clip: record("clip"),
    fill: () => calls.push(`fill(${String(context.fillStyle)})`),
    stroke: () =>
      calls.push(`stroke(${String(context.strokeStyle)},${context.lineWidth})`),
    fillRect: record("fillRect"),
    clearRect: record("clearRect"),
    fillText: (text: string, x: number, y: number) =>
      calls.push(`fillText(${text},${Math.round(x)},${Math.round(y)})`),
    strokeText: (text: string, x: number, y: number) =>
      calls.push(`strokeText(${text},${Math.round(x)},${Math.round(y)})`),
    drawImage: record("drawImage"),
    arc: record("arc"),
    setLineDash: record("setLineDash"),
  };
  return context;
}

/** A raster target backed by the fake context and a jsdom canvas element. */
export function createFakeTarget(
  width: number,
  height: number,
): RasterTarget & { ctx: FakeContext } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: createFakeContext(), width, height };
}
