"use client";
import { useEffect, useState } from "react";
import type { View3dControls } from "./useView3d";

/** Shown over the 3D playfield on a mouse until the pointer is locked (spec §7). */
export const VIEW3D_HINT_TEXT = "Klik om te richten · V wisselt camera";
/** Media query of a precise pointer (a mouse): the only kind the click-to-aim hint is for. */
const FINE_POINTER_QUERY = "(pointer: fine)";

/**
 * Everything the 3D view adds to the playfield, rendered just before the 2D canvas: the layer the
 * view puts a fresh WebGL canvas into each time it starts (spec §6.2) — under the 2D canvas and
 * taking no pointer events, so the 2D canvas keeps every click, move and wheel — and, stacked
 * above the 2D canvas by their z-index, the hint and the toast. The layer is empty in 2D.
 *
 * @param props - The 3D view's controls.
 * @returns The layer and the messages.
 */
export function View3dLayer({
  layerRef,
  ...state
}: View3dControls): React.JSX.Element {
  return (
    <>
      <div
        ref={layerRef}
        aria-hidden="true"
        data-testid="arena-3d-layer"
        className="pointer-events-none absolute inset-0"
      />
      <View3dMessages {...state} />
    </>
  );
}

/**
 * True while the primary pointer is precise (a mouse); updates when that changes. Stays `false`
 * where `matchMedia` is missing (some test environments, old browsers).
 */
function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(FINE_POINTER_QUERY);
    const apply = (): void => setFine(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return fine;
}

/**
 * The 3D view's messages over the playfield: the click-to-aim hint — while 3D runs on a mouse
 * that has neither locked the pointer nor fallen back to lock-free aiming, low on the playfield
 * just above the footer, clear of the character in the middle of the view — and the "3D werkt
 * niet op dit apparaat" toast.
 *
 * @param props - Whether 3D runs, the pointer-lock state and the toast.
 * @returns The messages, or nothing.
 */
function View3dMessages({
  active,
  notice,
  locked,
  lockFree,
}: Omit<View3dControls, "layerRef">): React.JSX.Element | null {
  const finePointer = useFinePointer();
  const hint = active && finePointer && !locked && !lockFree;
  if (!hint && !notice) return null;
  return (
    <>
      {hint ? (
        <p className="arena-label pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded bg-black/70 px-3 py-2 text-center text-sm text-[#c9d1d9]">
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
