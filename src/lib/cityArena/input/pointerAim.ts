import type { InputState } from "./inputState";

/** The subset of the canvas element the aim binding needs (injectable in tests). */
export type PointerAimTarget = Pick<
  HTMLElement,
  "addEventListener" | "removeEventListener" | "getBoundingClientRect"
>;

/** Live mouse position on the canvas in CSS pixels, plus the detach function. */
export type PointerAim = {
  position(): [number, number] | null;
  detach(): void;
};

/** `PointerEvent.button` of the left mouse button. */
const PRIMARY_BUTTON = 0;
/**
 * Bit for the primary (left) button in `PointerEvent.buttons`. Chording: releasing the primary
 * button while another mouse button is still down does not fire `pointerup` (only releasing the
 * last held button does), so the move and up handlers sync `fire` from this bit instead of
 * trusting the event type alone.
 */
const PRIMARY_BUTTON_MASK = 1;

/** True for a move that reports the primary button going down while another is held. */
function isChordedPress(event: PointerEvent): boolean {
  return (
    event.type === "pointermove" &&
    event.button === PRIMARY_BUTTON &&
    (event.buttons & PRIMARY_BUTTON_MASK) !== 0
  );
}

/** Releases the pointer's fire once the event says the primary button is no longer held. */
function releaseFireIfPrimaryUp(state: InputState, event: PointerEvent): void {
  if ((event.buttons & PRIMARY_BUTTON_MASK) === 0)
    state.setButton("pointer", "fire", false);
}

/** Where the pointer is on the target, CSS pixels from its top-left corner. */
function pointOn(
  target: PointerAimTarget,
  event: PointerEvent,
): [number, number] {
  const rect = target.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

/** The pointer events the aim listens to, each with its handler. */
type PointerHandlers = Record<
  | "pointermove"
  | "pointerdown"
  | "pointerup"
  | "pointercancel"
  | "pointerleave",
  (event: PointerEvent) => void
>;

/** Adds every handler to `target`; returns the function that removes them all. */
function listenAll(
  target: PointerAimTarget,
  handlers: PointerHandlers,
): () => void {
  const entries = Object.entries(handlers) as [
    keyof PointerHandlers,
    (event: PointerEvent) => void,
  ][];
  for (const [type, handler] of entries) target.addEventListener(type, handler);
  return () => {
    for (const [type, handler] of entries)
      target.removeEventListener(type, handler);
  };
}

/**
 * Binds mouse movement (aim position) and the left button (fire) on the canvas; touch pointers
 * belong to the stick and the buttons. A left press made while another button is held (the right
 * one aims down the sights) arrives as a `pointermove`, and fires too.
 *
 * @param target - The playfield canvas.
 * @param state - The input state the fire button is written to.
 * @param onUserGesture - Called on a primary click, e.g. to unlock audio.
 * @param claimsClick - True when another binding owns the next click — the 3D view's click that
 * takes the pointer lock (spec §6.3) — so that click aims but does not shoot.
 * @returns The live pointer position and the detach function.
 */
export function attachPointerAim(
  target: PointerAimTarget,
  state: InputState,
  onUserGesture?: () => void,
  claimsClick?: () => boolean,
): PointerAim {
  let position: [number, number] | null = null;
  const press = (): void => {
    onUserGesture?.();
    if (!claimsClick?.()) state.setButton("pointer", "fire", true);
  };
  const onMove = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    position = pointOn(target, event);
    if (isChordedPress(event)) press();
    else releaseFireIfPrimaryUp(state, event);
  };
  const onDown = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse" || event.button !== PRIMARY_BUTTON)
      return;
    position = pointOn(target, event);
    press();
  };
  const onUp = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") releaseFireIfPrimaryUp(state, event);
  };
  const onLeave = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    position = null;
    state.setButton("pointer", "fire", false);
  };
  const unlisten = listenAll(target, {
    pointermove: onMove,
    pointerdown: onDown,
    pointerup: onUp,
    pointercancel: onUp,
    pointerleave: onLeave,
  });
  return {
    position: () => position,
    detach() {
      position = null;
      state.setButton("pointer", "fire", false);
      unlisten();
    },
  };
}
