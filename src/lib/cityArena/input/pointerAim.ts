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
  const track = (event: PointerEvent): void => {
    const rect = target.getBoundingClientRect();
    position = [event.clientX - rect.left, event.clientY - rect.top];
  };
  const press = (): void => {
    onUserGesture?.();
    if (!claimsClick?.()) state.setButton("pointer", "fire", true);
  };
  const onMove = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    track(event);
    if (isChordedPress(event)) press();
    else releaseFireIfPrimaryUp(state, event);
  };
  const onDown = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse" || event.button !== PRIMARY_BUTTON)
      return;
    track(event);
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
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerdown", onDown);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onUp);
  target.addEventListener("pointerleave", onLeave);
  return {
    position: () => position,
    detach() {
      position = null;
      state.setButton("pointer", "fire", false);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerdown", onDown);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      target.removeEventListener("pointerleave", onLeave);
    },
  };
}
