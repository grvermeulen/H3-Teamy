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

/** Binds mouse movement (aim position) and the left button (fire) on the canvas; touch pointers belong to the stick and the buttons. */
export function attachPointerAim(
  target: PointerAimTarget,
  state: InputState,
): PointerAim {
  let position: [number, number] | null = null;
  const onMove = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    const rect = target.getBoundingClientRect();
    position = [event.clientX - rect.left, event.clientY - rect.top];
  };
  const onDown = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse" || event.button !== PRIMARY_BUTTON)
      return;
    event.preventDefault();
    onMove(event);
    state.setButton("pointer", "fire", true);
  };
  const onUp = (event: PointerEvent): void => {
    if (event.pointerType === "mouse")
      state.setButton("pointer", "fire", false);
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
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerdown", onDown);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      target.removeEventListener("pointerleave", onLeave);
    },
  };
}
