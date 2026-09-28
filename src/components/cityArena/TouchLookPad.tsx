"use client";

import { useEffect } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { TouchLook } from "@/lib/cityArena/input/touchLook";
import { capturePointer } from "./TouchStick";

/** Props for {@link TouchLookPad}. */
type TouchLookPadProps = {
  /** The pad the 3D frame reads its turn from. */
  look: TouchLook;
};

/**
 * The 3D look pad on touch (spec §6): the right 55 % of the playfield, where the aim stick sits in
 * 2D, under the buttons and the radar in stacking order. A drag anywhere on it turns the camera
 * and never fires — shooting is the fire button's. Like the stick surfaces it is `aria-hidden`: a
 * touch-only convenience layer, with the mouse and keyboard as the accessible equivalent.
 *
 * @param props - The look pad to feed.
 * @returns The surface.
 */
export default function TouchLookPad({
  look,
}: TouchLookPadProps): React.JSX.Element {
  useEffect(() => () => look.reset(), [look]);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    look.onDown(event);
    capturePointer(event);
  };
  return (
    <div
      data-testid="touch-look-pad"
      aria-hidden="true"
      className="absolute inset-y-0 right-0 w-[55%] touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={(event) => look.onMove(event)}
      onPointerUp={(event) => look.onUp(event)}
      onPointerCancel={(event) => look.onUp(event)}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
