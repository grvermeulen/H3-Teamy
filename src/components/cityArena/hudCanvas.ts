"use client";

/** The largest device pixel ratio the 2D canvas renders at, at full render scale. */
const MAX_CANVAS_DPR = 2;

/**
 * Sizes the playfield's 2D canvas to its layout box (device-pixel aware), clears it and returns
 * its context transformed to CSS pixels. Both views paint through it: the 2D renderer draws the
 * whole scene on it, the 3D view uses it as the transparent HUD layer over the WebGL canvas.
 *
 * @param canvas - The playfield's 2D canvas.
 * @param rect - Its layout box.
 * @param renderScale - 1 at full quality; below 1 renders at one device pixel per CSS pixel.
 * @returns The cleared context, or `null` when the canvas has none.
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  rect: DOMRect,
  renderScale: number,
): CanvasRenderingContext2D | null {
  const dpr = Math.min(
    renderScale === 1 ? MAX_CANVAS_DPR : 1,
    window.devicePixelRatio || 1,
  );
  const targetWidth = Math.round(rect.width * dpr);
  const targetHeight = Math.round(rect.height * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  return context;
}
