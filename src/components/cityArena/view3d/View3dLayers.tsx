"use client";
import type { RefObject } from "react";

/** Shown over the 3D playfield on a mouse until the pointer is locked (spec §7). */
export const VIEW3D_HINT_TEXT = "Klik om te richten · V wisselt camera";

/** Props for {@link View3dCanvas}. */
type View3dCanvasProps = {
  /** Whether the 3D view is on. */
  shown: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
};

/**
 * The WebGL canvas, stacked under the 2D canvas (spec §6.2). It takes no pointer events: the 2D
 * canvas above keeps every click, move and wheel, so no input binding moves.
 *
 * @param props - Whether to render it, and the ref the 3D view renders into.
 * @returns The canvas, or nothing in 2D.
 */
export function View3dCanvas({
  shown,
  canvasRef,
}: View3dCanvasProps): React.JSX.Element | null {
  if (!shown) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="arena-3d-canvas"
      className="pointer-events-none absolute inset-0 block h-full w-full"
    />
  );
}

/** Props for {@link View3dMessages}. */
type View3dMessagesProps = {
  /** Show the click-to-aim hint: 3D, playing, a fine pointer, not yet locked. */
  hint: boolean;
  /** The failure toast, or `null`. */
  notice: string | null;
};

/**
 * The 3D view's messages over the playfield: the click-to-aim hint and the "3D werkt niet op dit
 * apparaat" toast.
 *
 * @param props - Whether to show the hint, and the toast text.
 * @returns The messages, or nothing.
 */
export function View3dMessages({
  hint,
  notice,
}: View3dMessagesProps): React.JSX.Element | null {
  if (!hint && !notice) return null;
  return (
    <>
      {hint ? (
        <p className="arena-label pointer-events-none absolute left-1/2 top-[62%] z-10 -translate-x-1/2 rounded bg-black/70 px-3 py-2 text-center text-sm text-[#c9d1d9]">
          {VIEW3D_HINT_TEXT}
        </p>
      ) : null}
      {notice ? (
        <div
          role="status"
          aria-live="polite"
          className="arena-label absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded border border-[var(--arena-amber)] bg-[var(--arena-amber-dim)] px-3 py-2 text-center text-[var(--arena-amber)]"
        >
          {notice}
        </div>
      ) : null}
    </>
  );
}
