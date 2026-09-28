import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  TOUCH_LOOK_RAD_PER_PX,
  createTouchLook,
} from "@/lib/cityArena/input/touchLook";
import TouchLookPad from "./TouchLookPad";

describe("TouchLookPad", () => {
  afterEach(() => {
    cleanup();
  });

  it("turns the look by a drag on the right-hand surface", () => {
    const look = createTouchLook(() => 1);
    render(<TouchLookPad look={look} />);
    const pad = screen.getByTestId("touch-look-pad");
    expect(pad.className).toContain("right-0");
    fireEvent.pointerDown(pad, { pointerId: 1, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 140, clientY: 50 });
    expect(look.take().yaw).toBeCloseTo(40 * TOUCH_LOOK_RAD_PER_PX);
    fireEvent.pointerUp(pad, { pointerId: 1, clientX: 140, clientY: 50 });
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 200, clientY: 50 });
    expect(look.take()).toEqual({ yaw: 0, pitch: 0 });
  });

  it("stops turning when the browser cancels the touch", () => {
    const look = createTouchLook(() => 1);
    render(<TouchLookPad look={look} />);
    const pad = screen.getByTestId("touch-look-pad");
    fireEvent.pointerDown(pad, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerCancel(pad, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 60, clientY: 0 });
    expect(look.take()).toEqual({ yaw: 0, pitch: 0 });
  });

  it("frees a finger still down when the pad goes away", () => {
    const look = createTouchLook(() => 1);
    const { unmount } = render(<TouchLookPad look={look} />);
    fireEvent.pointerDown(screen.getByTestId("touch-look-pad"), {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });
    unmount();
    look.onDown({ pointerId: 2, clientX: 0, clientY: 0 });
    look.onMove({ pointerId: 2, clientX: 5, clientY: 0 });
    expect(look.take().yaw).toBeCloseTo(5 * TOUCH_LOOK_RAD_PER_PX);
  });
});
